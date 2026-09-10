import copy
import json
import os
from pathlib import Path
import tempfile
import subprocess
import unittest
from uuid import uuid4
from backend.app.replay_delta import apply, diff, event_delta
from backend.app import storage as s
from backend.app.storage_import import import_archive


class DeltaTests(unittest.TestCase):
    def test_new_nullable_world_field_is_recorded(self):
        w = {
            "seq": 0,
            "agents": [],
            "tiles": [],
            "config": {"size": 1},
            "proposals": [],
        }
        before = copy.deepcopy(w)
        ops = event_delta(
            w,
            {
                "seq": 1,
                "patch": {
                    "meta": {"seq": 1, "optional": None},
                    "agents": [],
                    "tiles": [],
                    "proposals": [],
                },
            },
        )
        self.assertEqual(apply(before, s.decode(s.encode(ops))), w)
        self.assertIn("optional", before)

    def test_property_order_is_preserved_for_javascript_hashes(self):
        before = {
            "a": {"x": 1, "y": 2},
            "queue": [{"id": 1, "x": 0, "y": 2}, {"id": 2, "x": 1, "y": 3}],
        }
        after = {"queue": [{"id": 2, "y": 3, "x": 1}, {"id": 3}], "a": {"y": 2, "x": 1}}
        result = apply(copy.deepcopy(before), s.decode(s.encode(diff(before, after))))
        self.assertEqual(json.dumps(result), json.dumps(after))

    def test_nested_changes_queues_and_serialization(self):
        before = {
            "agents": [
                {
                    "id": 1,
                    "hp": 100,
                    "pregnancy": {"day": 5},
                    "memories": [{"id": str(i), "text": "经历"} for i in range(200)],
                }
            ],
            "tiles": [{"water": 2}],
            "pending": [1, 2],
        }
        after = copy.deepcopy(before)
        a = after["agents"][0]
        a["hp"] = 88
        del a["pregnancy"]
        a["memories"] = a["memories"][1:] + [{"id": "200", "text": "新经历"}]
        after["agents"].append({"id": 2})
        after["tiles"][0]["food"] = 0
        after["pending"] = []
        ops = s.decode(s.encode(diff(before, after)))
        self.assertIn("queue", [op[0] for op in ops])
        self.assertEqual(apply(copy.deepcopy(before), ops), after)
        self.assertLess(len(json.dumps(ops)), len(json.dumps(after)) / 3)


@unittest.skipUnless(
    os.getenv("MYSQL_TEST") == "1",
    "MYSQL_TEST=1 enables project MySQL integration tests",
)
class StorageIntegration(unittest.TestCase):
    def setUp(self):
        s.initialize_schema()
        self.names = []
        fixture = subprocess.run(
            [
                "node",
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                """
import {createWorld} from './frontend/src/sim/world.ts';
import {nextTask,act,endDay} from './frontend/src/sim/engine.ts';
import {makeRecord} from './frontend/src/runtime/model.ts';
const w=createWorld({population:2,days:1,worldModel:'legacy'},'storage-fixture');
const initial={world:structuredClone(w)},events=[],records=[];
while(w.cursor.phase!=='complete') {
 const t=nextTask(w);
 if(t){const r=makeRecord(w,t);r.decision={intent:'fixture',action:w.seq===0?{type:'chat',text:'一起合作采集 ABC'}:{type:'wait'}};r.status='committed';events.push(act(w,t.agent.id,r.decision,t.id));records.push(r);}
 else events.push(endDay(w));
}
console.log(JSON.stringify({initial,events,records,final:{world:w,elapsedMs:123}}));
""",
            ],
            cwd=s.ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        data = json.loads(fixture.stdout)
        self.final = data["final"]
        self.initial = data["initial"]
        self.events = data["events"]
        self.records = {r["id"]: r for r in data["records"]}
        self.name = "storage-test-" + uuid4().hex[:12]
        self.names.append(self.name)
        s.create(self.name, {"world": self.initial["world"], "elapsedMs": 0})

    def tearDown(self):
        for name in self.names:
            self.assertTrue(name.startswith(("storage-test-", "import-")))
            with s.transaction() as q:
                for table in (
                    "events",
                    "experiences",
                    "action_time",
                    "agent_usage",
                    "decisions",
                    "pending",
                    "snapshots",
                    "replay_events",
                    "migrations",
                ):
                    q.execute(f"DELETE FROM {table} WHERE experiment=%s", (name,))
                q.execute("DELETE FROM experiments WHERE name=%s", (name,))
            folder = s.ROOT / "artifacts" / name
            if folder.exists():
                (folder / "storage.json").unlink(missing_ok=True)
                folder.rmdir()

    def entries(self):
        return [
            {"event": e, "record": self.records.get(e["decisionId"])}
            for e in self.events
            if e["seq"] <= self.final["world"]["seq"]
        ]

    def test_replay_atomic_retry_and_export_import(self):
        entries = self.entries()
        r = next(iter(self.records.values()))
        s.save_pending(self.name, r)
        s.commit(self.name, 0, self.final, entries)
        self.assertTrue(s.commit(self.name, 0, self.final, entries)["duplicate"])
        self.assertIsNone(s.load_pending(self.name, r["id"]))
        w = copy.deepcopy(self.initial["world"])
        self.assertEqual(s.replay(self.name, 0)["world"], w)
        for e in self.events:
            event_delta(w, e)
            self.assertEqual(
                json.dumps(s.replay(self.name, e["seq"])["world"]), json.dumps(w)
            )
        self.assertEqual(s.checkpoint(self.name), self.final)
        with s.transaction() as q:
            q.execute(
                "SELECT COUNT(*) n FROM replay_events WHERE experiment=%s", (self.name,)
            )
            self.assertEqual(q.fetchone()["n"], w["seq"])
        self.assertTrue(s.time_stats(self.name)["rows"])
        with tempfile.NamedTemporaryFile(suffix=".json") as f:
            for part in s.export_stream(self.name):
                f.write(part.encode())
            f.flush()
            result = import_archive(Path(f.name))
            self.names.append(result["name"])
        self.assertEqual(s.checkpoint(result["name"]), self.final)
        self.assertEqual(s.replay(result["name"], w["seq"])["world"], w)
        self.assertEqual(s.time_stats(result["name"]), s.time_stats(self.name))

    def test_initialize_retry_and_missing_marker_recover(self):
        from fastapi.testclient import TestClient
        from backend.app.main import app

        folder = s.ROOT / "artifacts" / self.name
        initial = {"world": self.initial["world"], "elapsedMs": 0}
        with TestClient(app) as client:
            response = client.post(f"/api/storage/{self.name}/initialize", json=initial)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["duplicate"])
            (folder / "storage.json").unlink()
            response = client.get(
                f"/api/experiments/{self.name}/snapshot?include_events=false"
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue((folder / "storage.json").exists())
            self.assertEqual(response.json()["world"], self.initial["world"])
            initial["world"]["agents"][0]["hp"] -= 1
            self.assertEqual(
                client.post(
                    f"/api/storage/{self.name}/initialize", json=initial
                ).status_code,
                409,
            )

    def test_rollback_preserves_pending_and_checkpoint(self):
        r = next(iter(self.records.values()))
        s.save_pending(self.name, r)
        bad = copy.deepcopy(self.final)
        bad["world"]["agents"][0]["hp"] = -999
        with self.assertRaises(ValueError):
            s.commit(self.name, 0, bad, self.entries())
        self.assertEqual(s.checkpoint(self.name)["world"]["seq"], 0)
        self.assertEqual(s.load_pending(self.name, r["id"]), r)
        self.assertEqual(s.search(self.name)["events"], [])
        with self.assertRaises(ValueError):
            s.commit(self.name, 1, self.final, self.entries())


if __name__ == "__main__":
    unittest.main()
