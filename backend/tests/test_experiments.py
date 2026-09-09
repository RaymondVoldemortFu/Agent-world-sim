import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import httpx
from backend.app.main import app
from backend.app import experiments


class FakeModel(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers['Content-Length']))
        time.sleep(0.15)
        body = json.dumps({'content': '{"action":{"type":"wait"}}', 'model': 'test',
                           'usage': {}, 'elapsedMs': 150}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ExperimentControlTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.artifacts = patch('backend.app.main.ARTIFACTS', self.root)
        self.artifacts.start()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), FakeModel)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.env = patch.dict('os.environ', {'SIMULATION_API_URL': f'http://127.0.0.1:{self.server.server_port}'})
        self.env.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost')

    async def asyncTearDown(self):
        await self.client.aclose()
        for folder in self.root.iterdir():
            if folder.is_dir():
                experiments.pause(folder)
                child = experiments._children.get(str(folder))
                if child:
                    child.wait(timeout=15)
                    experiments.writer(folder)
        self.server.shutdown()
        self.server.server_close()
        self.env.stop()
        self.artifacts.stop()
        self.tmp.cleanup()

    async def wait_for(self, name, predicate):
        import asyncio
        for _ in range(150):
            data = (await self.client.get(f'/api/experiments/{name}/snapshot')).json()
            if predicate(data):
                return data
            await asyncio.sleep(0.05)
        self.fail('Runner did not reach expected checkpoint')

    async def test_pause_resume_preserves_journal_and_rejects_duplicate_writer(self):
        response = await self.client.post('/api/experiments', json={
            'mode': 'llm', 'config': {'population': 2, 'days': 20, 'size': 15, 'inventoryCapacity': 17}})
        self.assertEqual(response.status_code, 200, response.text)
        name = response.json()['name']
        await self.wait_for(name, lambda d: d['world']['seq'] >= 1)
        duplicate = await self.client.post(f'/api/experiments/{name}/resume')
        self.assertEqual(duplicate.status_code, 409)
        paused = await self.client.post(f'/api/experiments/{name}/pause')
        self.assertEqual(paused.json()['state'], 'stopping')
        self.assertEqual((await self.client.post(f'/api/experiments/{name}/resume')).status_code, 409)
        data = await self.wait_for(name, lambda d: d['control']['state'] == 'paused')
        self.assertTrue(data['control']['canResume'])
        seq = data['world']['seq']
        before = (self.root / name / 'events.jsonl').read_text()
        self.assertEqual(data['world']['config']['inventoryCapacity'], 17)
        self.assertEqual((await self.client.post(f'/api/experiments/{name}/resume')).status_code, 200)
        await self.wait_for(name, lambda d: d['world']['seq'] > seq)
        await self.client.post(f'/api/experiments/{name}/pause')
        final = await self.wait_for(name, lambda d: d['control']['state'] == 'paused')
        journal = (self.root / name / 'events.jsonl').read_text()
        self.assertTrue(journal.startswith(before))
        events = [json.loads(line) for line in journal.splitlines()]
        self.assertEqual([e['seq'] for e in events], list(range(1, final['world']['seq'] + 1)))
        self.assertEqual((await self.client.post(f'/api/experiments/{name}/pause')).json()['state'], 'paused')

    async def test_new_experiments_are_independent_and_completed_runs_cannot_resume(self):
        names = []
        for _ in range(2):
            response = await self.client.post('/api/experiments', json={
                'mode': 'scripted', 'config': {'population': 1, 'days': 1, 'size': 10}})
            self.assertEqual(response.status_code, 200, response.text)
            names.append(response.json()['name'])
            data = await self.wait_for(names[-1], lambda d: d['control']['state'] == 'completed')
            self.assertEqual(data['world']['config']['size'], 10)
        self.assertNotEqual(*names)
        self.assertTrue(all((self.root / name / 'checkpoint.json').is_file() for name in names))
        self.assertEqual((await self.client.post(f'/api/experiments/{names[0]}/resume')).status_code, 409)

    async def test_invalid_config_names_and_remote_origins_are_rejected(self):
        response = await self.client.post('/api/experiments', json={'config': {'size': 2}})
        self.assertEqual(response.status_code, 422)
        self.assertEqual((await self.client.get('/api/experiments')).json(), [])
        self.assertEqual((await self.client.post('/api/experiments/.env/pause')).status_code, 400)
        self.assertEqual((await self.client.post('/api/experiments/missing/resume')).status_code, 404)
        response = await self.client.post('/api/experiments', json={}, headers={'Origin': 'https://example.com'})
        self.assertEqual(response.status_code, 403)


if __name__ == '__main__':
    unittest.main()
