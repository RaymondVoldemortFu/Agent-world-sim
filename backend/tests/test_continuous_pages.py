import asyncio
import copy
import os
import unittest
from uuid import uuid4
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app.continuous_api import app
from backend.app import continuous_news as source, news, storage as s


@unittest.skipUnless(os.getenv("MYSQL_TEST") == "1", "requires isolated MySQL fixtures")
class ContinuousPagesTests(unittest.TestCase):
    def setUp(self):
        self.name = "ct-pages-" + uuid4().hex[:10]
        self.actual_jobs = source.jobs
        self.jobs_patch = patch("backend.app.continuous_news.jobs", return_value=[])
        self.jobs_patch.start()
        self.client = TestClient(app).__enter__()
        self.w = {
            "id": self.name,
            "version": "continuous-game-2",
            "time": 0,
            "seq": 0,
            "status": "paused",
            "agents": [
                {
                    "id": i,
                    "name": f"居民{i}",
                    "hp": 100,
                    "food": 5000,
                    "bodyAt": 0,
                    "grain": 3,
                    "dead": False,
                    "x": 0,
                    "y": 0,
                }
                for i in (1, 2, 3)
            ],
            "stores": [
                {"id": "keep-store", "label": "庄园口粮仓", "grain": 20, "reserved": 0}
            ],
            "gates": [],
            "fields": [],
        }
        self.path = "/runs/" + self.name
        self.assertEqual(
            self.client.post(self.path, json={"world": self.w}).status_code, 200
        )
        self.events = []

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.jobs_patch.stop()
        with s.transaction() as q:
            for table, key in [
                ("continuous_events", "run_id"),
                ("continuous_snapshots", "run_id"),
                ("continuous_experiences", "run_id"),
                ("continuous_experience_progress", "run_id"),
                ("continuous_contexts", "run_id"),
                ("continuous_thoughts", "run_id"),
                ("daily_news", "experiment"),
                ("news_streams", "experiment"),
                ("news_attempts", "experiment"),
                ("continuous_runs", "id"),
            ]:
                q.execute(f"DELETE FROM {table} WHERE {key}=%s", (self.name,))

    def commit(self, kind, text="", actor=None, listeners=None, time=None):
        prior = self.w["seq"]
        self.w["seq"] += 1
        self.w["time"] = time if time is not None else self.w["time"] + 100
        e = {
            "seq": self.w["seq"],
            "time": self.w["time"],
            "type": kind,
            "text": text,
            "actor": actor,
            "listeners": listeners or [],
            "patch": {"meta": {"seq": self.w["seq"], "time": self.w["time"]}},
        }
        r = self.client.post(
            self.path + "/commit",
            json={"expected": prior, "world": self.w, "events": [e]},
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.events.append(e)

    def test_personal_history_includes_only_actor_or_actual_recipient_and_has_stable_cursors(
        self,
    ):
        self.commit("plan", "准备搬粮", 1)
        self.commit("speech", "王税需要核对", 1, [2])
        self.commit("speech", "远处私下交流", 3, [])
        self.commit("withdraw", "领取三公斤粮", 2)
        self.commit("idle", "", 2)
        r = self.client.get(
            self.path + "/experiences?agent_id=2&limit=1&through=5"
        ).json()
        self.assertEqual([e["seq"] for e in r["rows"]], [4])
        self.assertEqual(r["nextCursor"], 4)
        self.commit("speech", "后来新闻", 1, [2])
        r = self.client.get(
            self.path + "/experiences?agent_id=2&before=4&through=5"
        ).json()
        self.assertEqual([e["seq"] for e in r["rows"]], [2])
        self.assertIsNone(r["nextCursor"])
        r = self.client.get(
            self.path + "/experiences?agent_id=2&source=heard&q=王税"
        ).json()
        self.assertEqual([e["seq"] for e in r["rows"]], [2])
        r = self.client.get(
            self.path + "/experiences?agent_id=1&source=inferred"
        ).json()
        self.assertEqual([e["seq"] for e in r["rows"]], [1])
        self.assertEqual(
            self.client.get(
                self.path + "/experiences?agent_id=1&start_day=3&end_day=1"
            ).status_code,
            422,
        )

    def test_news_reads_exact_closed_days_caches_prefix_and_preserves_all_speeches(
        self,
    ):
        self.commit("speech", "第一日原话：已经承诺，不等于交付", 1, [2])
        self.commit("day_end", "第1天结束", time=86400000)
        boundary = self.w["seq"]
        self.commit("speech", "第二日原话", 2, [1], time=86400000)
        self.commit("day_end", "第2天结束", time=172800000)
        w, dialogues, end = source.day_source(self.name, 1)
        self.assertEqual(end, boundary)
        self.assertEqual(len(dialogues), 1)
        state, speeches, counts = source.day_material(w, dialogues, 1)
        self.assertIn("庄园口粮仓", state)
        self.assertEqual(counts["alive"], 3)
        self.assertIn("第一日原话", speeches[0])
        self.assertNotIn("第二日原话", str(speeches))
        self.assertEqual(
            self.client.post(self.path + "/news", json={"enabled": True}).status_code,
            200,
        )
        calls = []
        self.assertTrue(any(job['experiment'] == self.name and job['next_day'] == 1 for job in self.actual_jobs()))

        async def send(messages, purpose):
            calls.append(copy.deepcopy(messages))
            return "今日报道：谷物仍在仓内。"

        asyncio.run(news.generate(self.name, 1, send, source=source))
        asyncio.run(news.generate(self.name, 2, send, source=source))
        self.assertEqual(calls[1][: len(calls[0])], calls[0])
        asyncio.run(news.generate(self.name, 2, send, source=source))
        self.assertEqual(len(calls), 2)
        feed = self.client.get(self.path + "/news").json()
        self.assertEqual(feed["generatedDays"], 2)
        self.assertEqual(feed["completedDays"], 2)
        self.assertNotIn("turn", feed["rows"][0])
        historical = self.client.get(self.path + f"/news?through={boundary}").json()
        self.assertEqual(historical["completedDays"], 1)
        self.assertEqual([r["day"] for r in historical["rows"]], [1])
        self.assertEqual(
            self.client.post(self.path + "/news", json={"enabled": False}).json(),
            {"enabled": False},
        )

    def test_quiescent_rewind_backs_up_and_removes_future_views(self):
        import tempfile
        import gzip
        import pickle
        from pathlib import Path
        from backend.app.continuous_rewind import prepare, backup, rewind
        self.commit('speech', '应保留的发言', 1, [2])
        self.commit('withdraw', '尾部动作', 2)
        self.commit('idle')
        self.client.get(self.path + '/experiences?agent_id=2')
        with s.transaction() as q:
            q.execute('INSERT INTO continuous_contexts VALUES(%s,1,%s)', (self.name, s.encode({'tail': ['earlier']})))
            q.execute('INSERT INTO daily_news(experiment,day,boundary,payload) VALUES(%s,1,3,%s)', (self.name, s.encode({'text': '未来新闻'})))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'backup.pkl.gz'
            with s.transaction() as q:
                w, old = prepare(q, self.name, 1, 3)
                counts = backup(q, self.name, path)
                restored = rewind(q, self.name, 1, w)
            self.assertEqual(counts['continuous_events'], 3)
            with gzip.open(path, 'rb') as f:
                self.assertEqual(pickle.load(f)['run'], self.name)
                records = []
                while (batch := pickle.load(f)) is not None:
                    if batch[0] == 'continuous_events': records.extend(batch[1])
                self.assertEqual(len(records), 3)
        self.assertEqual(self.client.get(self.path).json(), restored)
        self.assertEqual(restored['time'], 100)
        self.assertEqual(self.client.get(self.path + '/replay?at=100').json(), restored)
        rows = self.client.get(self.path + '/experiences?agent_id=2').json()['rows']
        self.assertEqual([r['text'] for r in rows], ['应保留的发言'])
        with s.transaction() as q:
            q.execute('SELECT payload FROM continuous_contexts WHERE run_id=%s', (self.name,))
            self.assertEqual(s.decode(q.fetchone()['payload']), {'tail': ['earlier']})
            q.execute('SELECT day FROM daily_news WHERE experiment=%s', (self.name,))
            self.assertIsNone(q.fetchone())

    def test_rewind_rejects_a_tail_that_has_new_model_context(self):
        from backend.app.continuous_rewind import prepare
        self.commit('speech', '原发言', 1)
        self.commit('think_started', '新上下文', 1)
        with s.transaction() as q:
            with self.assertRaisesRegex(ValueError, '需要重建上下文'):
                prepare(q, self.name, 1, 2)
        self.assertEqual(self.client.get(self.path).json()['seq'], 2)
