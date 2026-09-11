import copy
import os
import unittest
from uuid import uuid4

from fastapi.testclient import TestClient
from unittest.mock import patch
from backend.app.continuous_api import app, COMPRESS, RULES
from backend.app import storage as s


@unittest.skipUnless(os.getenv("MYSQL_TEST") == "1", "requires isolated MySQL fixtures")
class ContinuousStorageTests(unittest.TestCase):
    def setUp(self):
        self.name = "ct-test-" + uuid4().hex[:12]
        self.client = TestClient(app).__enter__()
        self.world = {
            "id": self.name,
            "version": "continuous-prototype-1",
            "seq": 0,
            "time": 0,
            "status": "running",
            "agents": [{"id": 1, "x": 0, "y": 0}],
            "stores": [],
            "fields": [],
            "gates": [],
        }
        self.assertEqual(
            self.client.post(
                "/runs/" + self.name, json={"world": self.world}
            ).status_code,
            200,
        )

    def tearDown(self):
        self.client.__exit__(None, None, None)
        with s.transaction() as q:
            for table in [
                "continuous_thoughts",
                "continuous_contexts",
                "continuous_events",
                "continuous_snapshots",
            ]:
                q.execute(f"DELETE FROM {table} WHERE run_id=%s", (self.name,))
            q.execute("DELETE FROM continuous_runs WHERE id=%s", (self.name,))

    def test_atomic_commit_idempotency_replay_and_conflict(self):
        w = copy.deepcopy(self.world)
        w.update(seq=1, time=100)
        w["agents"][0]["x"] = 20
        event = {
            "seq": 1,
            "time": 50,
            "type": "walk",
            "actor": 1,
            "text": "",
            "patch": {"meta": {"seq": 1}, "agents": w["agents"]},
        }
        payload = {"expected": 0, "world": w, "events": [event]}
        path = "/runs/" + self.name
        self.assertEqual(
            self.client.post(path + "/commit", json=payload).status_code, 200
        )
        self.assertTrue(
            self.client.post(path + "/commit", json=payload).json()["duplicate"]
        )
        self.assertEqual(
            self.client.get(path + "/replay?at=40").json()["agents"][0]["x"], 0
        )
        self.assertEqual(
            self.client.get(path + "/replay?at=80").json()["agents"][0]["x"], 20
        )
        self.assertEqual(self.client.get(path + "/replay?at=1000").json()["time"], 100)
        bad = copy.deepcopy(payload)
        bad["world"]["agents"][0]["x"] = 999
        self.assertEqual(self.client.post(path + "/commit", json=bad).status_code, 409)
        self.assertEqual(self.client.get(path).json(), w)

    def test_clock_only_advance_and_reject_unlogged_change(self):
        w = copy.deepcopy(self.world)
        w["time"] = 1000
        path = "/runs/" + self.name + "/commit"
        self.assertEqual(
            self.client.post(
                path, json={"expected": 0, "world": w, "events": []}
            ).status_code,
            200,
        )
        w["agents"][0]["x"] = 5
        self.assertEqual(
            self.client.post(
                path, json={"expected": 0, "world": w, "events": []}
            ).status_code,
            409,
        )

    def test_sparse_dialogue_cursor_and_channel_metadata(self):
        path = "/runs/" + self.name
        w = copy.deepcopy(self.world)
        events = []
        for seq, kind in enumerate(["speaking", "walk", "speech", "speaking", "speech"], 1):
            patch_data = {"meta": {"seq": seq}}
            if seq == 1:
                w["agents"][0]["voice"] = {"mode": "shout"}
                patch_data["agents"] = copy.deepcopy(w["agents"])
            events.append({"seq": seq, "time": seq * 100, "type": kind, "actor": 1,
                           "text": "核对账目" if kind == "speech" else "", "listeners": [2, 3],
                           "patch": patch_data, **({"channel": "public_speak"} if seq == 5 else {})})
        w.update(seq=5, time=500)
        self.assertEqual(self.client.post(path + "/commit", json={"expected": 0, "world": w, "events": events}).status_code, 200)
        a = self.client.get(path + "/dialogue?limit=1&through=3").json()
        self.assertTrue(a["hasMore"])
        self.assertEqual(a["events"][0]["channel"], "shout")
        self.assertNotIn("patch", a["events"][0])
        b = self.client.get(path + f"/dialogue?after={a['nextCursor']}&limit=1&through=3").json()
        self.assertFalse(b["hasMore"])
        self.assertEqual([e["seq"] for e in b["events"]], [3])
        self.assertEqual(b["events"][0]["listeners"], [2, 3])
        c = self.client.get(path + "/dialogue?after=3&through=99").json()
        self.assertEqual(c["through"], 5)
        self.assertEqual(c["events"][-1]["channel"], "public_speak")
        self.assertEqual(self.client.get(path + "/dialogue?through=0").json()["events"], [])
        self.assertEqual(self.client.get(path + "/dialogue?limit=0").status_code, 422)
        self.assertEqual(self.client.get(path).json(), w)

    @patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-only"})
    def test_model_prefix_incremental_history_and_idempotent_request(self):
        calls = []

        class Fake:
            async def post(self, url, **kwargs):
                calls.append(kwargs["json"])

                class Response:
                    status_code = 200

                    def json(self):
                        return {
                            "choices": [
                                {
                                    "finish_reason": "stop",
                                    "message": {"content": '{"summary":"已领取口粮，准备耕作"}' if kwargs["json"]["messages"][0]["content"] == COMPRESS else '{"intent":"先领取口粮"}'},
                                }
                            ],
                            "usage": {"prompt_tokens": 300, "completion_tokens": 20},
                        }

                return Response()

        actual = app.state.client
        app.state.client = Fake()
        try:
            req = {
                "actor": 1,
                "requestId": "r1",
                "person": {
                    "id": 1,
                    "name": "甲",
                    "sex": "M",
                    "personality": [0.1, 0.5, 0.9, 0.2, 0.8],
                },
                "atlas": "hall=大厅",
                "observation": "当前随身粮食1kg",
            }
            path = "/runs/" + self.name + "/think"
            a = self.client.post(path, json=req)
            self.assertEqual(a.status_code, 200)
            b = self.client.post(path, json=req)
            self.assertEqual(a.json(), b.json())
            self.assertEqual(len(calls), 1)
            req.update(requestId="r2", observation="取粮完成，随身7kg")
            self.assertEqual(self.client.post(path, json=req).status_code, 200)
            self.assertEqual(
                calls[1]["messages"][: len(calls[0]["messages"])], calls[0]["messages"]
            )
            self.assertEqual(calls[1]["messages"][-2]["role"], "assistant")
            req.update(requestId="r3", contextWindow=4000)
            with patch("backend.app.continuous_api.tokens", side_effect=[3500, 1000]):
                self.assertNotIn("error", self.client.post(path, json=req).json())
            self.assertEqual(len(calls), 4)
            self.assertEqual(calls[2]["messages"][0]["content"], COMPRESS)
            self.assertEqual(calls[3]["messages"][0]["content"], RULES)
            self.assertIn("已领取口粮，准备耕作", calls[3]["messages"][-2]["content"])
            req.update(requestId="r4", contextWindow=3999)
            self.assertEqual(self.client.post(path, json=req).status_code, 422)
            for call in calls:
                self.assertFalse(
                    {"max_tokens", "max_completion_tokens", "max_output_tokens"}
                    & call.keys()
                )
        finally:
            app.state.client = actual
