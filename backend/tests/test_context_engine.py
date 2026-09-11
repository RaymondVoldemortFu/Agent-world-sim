import copy
import json
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4
from backend.app import storage as s
from backend.app import context_engine as ce, context_repository as repo


def observation():
    return {
        "protocol": "context-1",
        "seq": 1,
        "day": 1,
        "minute": 0,
        "self": {
            "id": 1,
            "name": "阿禾",
            "sex": "F",
            "adult": True,
            "personality": [0.9, 0.8, 0.7, 0.1, 0.2],
            "callsDay": 0,
            "tokensDay": 0,
            "hp": 100,
            "hunger": 80,
            "water": 5,
            "ap": 5,
            "position": [1, 1],
            "region": 0,
            "loneliness": 0,
            "lonelinessCapacity": 60,
            "depressed": False,
            "bag": [{"item": "grain", "kg": 1}],
            "knowledge": ["flake"],
            "skills": {},
        },
        "policy": {
            "dailyAP": 5,
            "bagKg": 15,
            "mapSize": 15,
            "minutesPerAP": 120,
            "llmDailyCalls": 3,
            "remainingCalls": 100,
            "llmDailyTokens": 6000,
            "remainingTokens": 1000000,
        },
        "knowledgeLibrary": {
            "flake": {
                "inputs": {"stone": 0.2},
                "outputs": {"flake": 0.15},
                "minutes": 30,
            }
        },
        "people": [],
        "proposals": [],
        "corpses": [],
        "messages": [],
        "memories": [],
        "memoryCandidates": [],
        "nearby": [],
        "ground": [],
        "jobs": [],
        "calendar": {"season": "spring"},
    }


class RenderingTests(unittest.TestCase):
    def test_beast_knowledge_is_shared_only_when_enabled(self):
        o = observation()
        for role in (None, 'prophet'):
            o['self']['role'] = role
            o['policy']['wildlifeEnabled'] = True
            enabled = ce.fixed(o)
            self.assertIn(ce.WILDLIFE_COMMON_KNOWLEDGE, enabled[0]['content'])
            self.assertIn('具体野兽的位置和动向仍须依据实际观察', enabled[0]['content'])
            o['policy']['wildlifeEnabled'] = False
            disabled = ce.fixed(o)
            self.assertNotIn(ce.WILDLIFE_COMMON_KNOWLEDGE, disabled[0]['content'])
            self.assertNotIn('单个成年人徒手无法战胜', ''.join(m['content'] for m in disabled))
        del o['policy']['wildlifeEnabled']
        self.assertEqual(ce.wildlife_common_knowledge(o), ce.WILDLIFE_COMMON_KNOWLEDGE)

    def test_experiment_window_overrides_service_default_and_validates_input(self):
        with patch.dict(os.environ, {"AGENT_CONTEXT_WINDOW": "65536"}):
            self.assertEqual(ce.context_window({"policy": {}}), 65536)
            self.assertEqual(ce.context_window({"policy": {"contextWindow": 16384}}), 16384)
            for invalid in (True, "16384", 3999, 262145, 16000.5):
                with self.assertRaises(ValueError):
                    ce.context_window({"policy": {"contextWindow": invalid}})

    def test_creation_knowledge_is_private_to_the_prophets_fixed_persona(self):
        ordinary = observation()
        prophet = copy.deepcopy(ordinary)
        prophet["self"]["role"] = "prophet"
        ordinary_messages = ce.fixed(ordinary)
        prophet_messages = ce.fixed(prophet)
        self.assertEqual(ordinary_messages[:2], prophet_messages[:2])
        self.assertNotIn("User", "".join(m["content"] for m in ordinary_messages))
        self.assertIn("名叫 User 的神灵创造", prophet_messages[2]["content"])
        self.assertIn("单个成年人徒手无法战胜", prophet_messages[0]["content"])
        self.assertIn("外向性 0.85", prophet_messages[2]["content"])

    def test_terrain_table_preserves_zero_overrides_and_shared_resources(self):
        tiles = [{"x": i, "y": 1, "biome": "hill", "water": 10, "resources": {"stone": 30000, "flint": 200 if i < 2 else 0}} for i in range(3)]
        text = ce.terrain_card(tiles)
        self.assertEqual(text.count("30000"), 1)
        self.assertIn("资源.flint=200", text)
        self.assertIn("(0,1)|hill|10|·|", text)
        self.assertIn("(2,1)|hill|10|0|", text)

    def test_five_bands_and_readable_observation(self):
        o = observation()
        low = copy.deepcopy(o)
        low["self"]["personality"] = [0] * 5
        high = copy.deepcopy(o)
        high["self"]["personality"] = [1] * 5
        self.assertIn("要求互惠", ce.persona(low))
        self.assertIn("主动帮助", ce.persona(high))
        text = ce.observation(o)["content"]
        self.assertIn("当前校准", text)
        self.assertIn("手持物品", text)
        self.assertNotIn('"self":', text)
        for v in [0, 0.2, 0.4, 0.6, 0.8, 1]:
            o["self"]["personality"] = [v] * 5
            self.assertEqual(len(ce.persona(o).splitlines()), 6)


@unittest.skipUnless(
    os.getenv("MYSQL_TEST") == "1", "MYSQL_TEST=1 enables project database tests"
)
class ContextTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        s.initialize_schema()
        self.run = "context-test-" + uuid4().hex[:12]
        self.sent = []
        self.window = patch.dict(os.environ, {"AGENT_CONTEXT_WINDOW": "16000"})
        self.window.start()
        self.addCleanup(self.window.stop)

    async def asyncTearDown(self):
        with s.transaction() as q:
            q.execute(
                "DELETE m FROM context_memory m JOIN context_nodes n ON n.id=m.node_id WHERE n.run_id=%s",
                (self.run,),
            )
            q.execute(
                "DELETE p FROM context_prepared p JOIN context_nodes n ON n.id=p.id WHERE n.run_id=%s",
                (self.run,),
            )
            q.execute("DELETE FROM context_nodes WHERE run_id=%s", (self.run,))

    def request(self, o, repair=None):
        return SimpleNamespace(
            runId=self.run,
            decisionId=f"{self.run}:{o['seq']}:{o['self']['id']}",
            context=o,
            parentTurnId=None,
            experiment=None,
            repair=repair,
            spentCalls=0,
            spentTokens=0,
        )

    async def provider(self, messages, purpose):
        self.sent.append((copy.deepcopy(messages), purpose))
        text = (
            {"summary": "计划尚未完成；阿禾曾承诺交换石材，兑现情况未知。"}
            if purpose == "compression"
            else {"intent": "维持计划", "note": "阿禾曾承诺交换石材，兑现情况未知。"}
        )
        return {
            "status": 200,
            "purpose": purpose,
            "content": json.dumps(text, ensure_ascii=False),
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 30,
                "prompt_cache_hit_tokens": 60,
            },
            "elapsedMs": 1,
            "model": "test",
        }

    async def test_append_only_prefix_cross_agent_and_idempotent_retry(self):
        o = observation()
        first = await ce.decide(self.request(o), "test", self.provider)
        retry = await ce.decide(self.request(o), "test", self.provider)
        self.assertEqual(first, retry)
        self.assertEqual(len(self.sent), 1)
        o["contextHead"] = first["contextTrace"]["turnId"]
        o["seq"] = 2
        o["day"] = 2
        o["self"]["hunger"] = 65
        second = await ce.decide(self.request(o), "test", self.provider)
        original = self.sent[0][0] + [
            {"role": "assistant", "content": first["content"]}
        ]
        self.assertEqual(self.sent[1][0][: len(original)], original)
        self.assertEqual(second["contextTrace"]["reusedMessages"], len(original))
        other = observation()
        other["self"]["id"] = 2
        other["self"]["name"] = "石头"
        other["self"]["personality"] = [0] * 5
        await ce.decide(self.request(other), "test", self.provider)
        self.assertEqual(self.sent[0][0][:2], self.sent[2][0][:2])
        self.assertNotEqual(self.sent[0][0][2], self.sent[2][0][2])

    async def test_compaction_preserves_knowledge_and_current_facts(self):
        o = observation()
        first = await ce.decide(self.request(o), "test", self.provider)
        head = first["contextTrace"]["turnId"]
        o["contextHead"] = head
        o["seq"] = 2
        o["day"] = 2
        # Persist a long real dialogue turn to force the next fixed-window compaction.
        node = repo.get(head)
        node["id"] = ce.digest([head, "long-dialogue-fixture"])
        node["parent"] = head
        node["base"] = None
        node["append"] = [
            {"role": "user", "content": "过去的听闻。" * 1300},
            {"role": "assistant", "content": '{"intent":"记录"}'},
        ]
        repo.save(node)
        o["contextHead"] = node["id"]
        o["proposals"] = [
            {"id": "p1", "from": 1, "to": 2, "accepted": True, "day": 2, "attempts": {}}
        ]
        with patch.dict(os.environ, {"AGENT_CONTEXT_WINDOW": "16000"}):
            result = await ce.decide(self.request(o), "test", self.provider)
        self.assertTrue(result["contextTrace"]["compressed"])
        self.assertEqual(len(result["auxiliaryAttempts"]), 1)
        self.assertEqual(self.sent[-2][1], "compression")
        self.assertNotIn("开放性 0.90", self.sent[-2][0][-1]["content"])
        self.assertIn("flake", self.sent[-1][0][3]["content"])
        self.assertIn("p1", self.sent[-1][0][-1]["content"])
        saved = repo.get(result["contextTrace"]["turnId"])
        with s.transaction() as q:
            q.execute(
                "SELECT payload FROM context_knowledge WHERE id=%s",
                (saved["knowledgeHash"],),
            )
            self.assertEqual(s.decode(q.fetchone()["payload"]), o["knowledgeLibrary"])
        before = len(self.sent)
        await ce.decide(self.request(o), "test", self.provider)
        self.assertEqual(len(self.sent), before)

    async def test_only_ancestor_memories_are_recalled(self):
        o = observation()
        o["memoryCandidates"] = [
            {
                "id": "old",
                "content": "阿禾承诺归还石斧",
                "day": 1,
                "source": "heard",
                "importance": 8,
            }
        ]
        first = await ce.decide(self.request(o), "test", self.provider)
        root = first["contextTrace"]["turnId"]
        branch = copy.deepcopy(o)
        branch["seq"] = 2
        branch["contextHead"] = root
        branch["memoryCandidates"] = [
            {
                "id": "secret",
                "content": "秘密藏宝地点",
                "day": 1,
                "source": "observed",
                "importance": 9,
            }
        ]
        sibling = await ce.decide(self.request(branch), "test", self.provider)
        o["seq"] = 3
        o["contextHead"] = root
        o["recallQuery"] = "秘密藏宝"
        o["memoryCandidates"] = []
        await ce.decide(self.request(o), "test", self.provider)
        self.assertNotIn("秘密藏宝地点", self.sent[-1][0][-1]["content"])
        o["recallQuery"] = "阿禾归还石斧"
        o["seq"] = 4
        await ce.decide(self.request(o), "test", self.provider)
        self.assertIn("阿禾承诺归还石斧", self.sent[-1][0][-1]["content"])
        o["self"]["id"] = 2
        with self.assertRaisesRegex(ValueError, "ancestry"):
            await ce.decide(self.request(o), "test", self.provider)

    async def long_context(self):
        o = observation()
        first = await ce.decide(self.request(o), "test", self.provider)
        node = repo.get(first["contextTrace"]["turnId"])
        node["id"] = uuid4().hex * 2
        node["parent"] = first["contextTrace"]["turnId"]
        node["base"] = None
        node["append"] = [{"role": "user", "content": "过去的听闻。" * 1300}]
        repo.save(node)
        o["seq"] = 2
        o["contextHead"] = node["id"]
        return o

    async def test_paid_compression_survives_decision_failure_and_retry(self):
        o = await self.long_context()
        async def failing(messages, purpose):
            result = await self.provider(messages, purpose)
            if purpose == "decision":
                result["error"] = "temporary failure"
            return result
        req = self.request(o)
        failed = await ce.decide(req, "test", failing)
        self.assertIn("failure", failed)
        attempt = failed["auxiliaryAttempts"][0]
        self.assertEqual(attempt["usage"]["prompt_tokens"], 100)
        before = len(self.sent)
        req.spentCalls = 2
        req.spentTokens = 260
        req.spentAttemptIds = [attempt["id"], failed["failure"]["id"]]
        result = await ce.decide(req, "test", self.provider)
        self.assertEqual(len(self.sent), before + 1)
        self.assertEqual(result["auxiliaryAttempts"][0]["id"], attempt["id"])
        self.assertEqual(repo.get(result["contextTrace"]["turnId"])["parent"], o["contextHead"])

    async def test_64k_preserves_long_history_then_compresses_near_capacity(self):
        o = await self.long_context()
        with patch.dict(os.environ, {"AGENT_CONTEXT_WINDOW": "65536"}):
            first = await ce.decide(self.request(o), "test", self.provider)
            self.assertFalse(first["contextTrace"]["compressed"])
            self.assertGreater(first["contextTrace"]["estimatedTokens"], 12000)
            node = repo.get(first["contextTrace"]["turnId"])
            node["parent"] = node["id"]
            node["id"] = uuid4().hex * 2
            node["base"] = None
            # Add enough activity to cross the new threshold while compression still fits.
            additional = 60000 - first["contextTrace"]["estimatedTokens"]
            node["append"] = [{"role": "user", "content": "a" * (additional * 2)}]
            repo.save(node)
            o["contextHead"] = node["id"]
            o["seq"] += 1
            second = await ce.decide(self.request(o), "test", self.provider)
            self.assertTrue(second["contextTrace"]["compressed"])
            self.assertEqual(self.sent[-2][1], "compression")
            self.assertLessEqual(ce.tokens(self.sent[-2][0]) + 1200, 65536)

    async def test_saved_window_controls_compression_independently_of_service(self):
        o = await self.long_context()
        o["policy"]["contextWindow"] = 65536
        # Test service defaults to 16k, but the experiment's 64k history is retained.
        large = await ce.decide(self.request(o), "test", self.provider)
        self.assertFalse(large["contextTrace"]["compressed"])
        o["policy"]["contextWindow"] = 16000
        with patch.dict(os.environ, {"AGENT_CONTEXT_WINDOW": "65536"}):
            small = await ce.decide(self.request(o), "test", self.provider)
        self.assertTrue(small["contextTrace"]["compressed"])

    async def test_bad_compaction_keeps_history_and_bills_each_real_attempt(self):
        o = await self.long_context()
        async def malformed(messages, purpose):
            result = await self.provider(messages, purpose)
            result["content"] = "{}"
            return result
        before = repo.messages(o["contextHead"])
        one = await ce.decide(self.request(o), "test", malformed)
        two = await ce.decide(self.request(o), "test", malformed)
        self.assertTrue(one["deferred"])
        self.assertNotEqual(one["auxiliaryAttempts"][0]["id"], two["auxiliaryAttempts"][0]["id"])
        self.assertEqual(repo.messages(o["contextHead"]), before)

    async def test_context_archive_restores_exact_history_and_rejects_cycles(self):
        o = await self.long_context()
        expected = repo.messages(o["contextHead"])
        with s.transaction() as q:
            nodes = list(repo.export_nodes(q, [o["contextHead"]]))
            q.execute("DELETE m FROM context_memory m JOIN context_nodes n ON n.id=m.node_id WHERE n.run_id=%s", (self.run,))
            q.execute("DELETE FROM context_nodes WHERE run_id=%s", (self.run,))
            for node in nodes:
                repo.insert(q, node)
            repo.validate_ancestry(q, [o["contextHead"]], self.run)
        self.assertEqual(repo.messages(o["contextHead"]), expected)
        cyclic = copy.deepcopy(nodes[0])
        cyclic["id"] = uuid4().hex * 2
        cyclic["parent"] = cyclic["id"]
        with self.assertRaisesRegex(ValueError, "Cycle"):
            with s.transaction() as q:
                repo.insert(q, cyclic)
                repo.validate_ancestry(q, [cyclic["id"]], self.run)

    async def test_budget_refusal_does_not_call_provider(self):
        o = observation()
        o["policy"]["remainingCalls"] = 0
        self.assertTrue(
            (await ce.decide(self.request(o), "test", self.provider))["deferred"]
        )
        self.assertEqual(self.sent, [])


if __name__ == "__main__":
    unittest.main()
