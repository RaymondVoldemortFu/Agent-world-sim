import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
import httpx
from backend.app.main import app, MODEL

class ProxyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.environment = patch.dict('os.environ', {'DEEPSEEK_API_KEY': 'test-only-secret'})
        self.environment.start()
        self.lifespan = app.router.lifespan_context(app)
        await self.lifespan.__aenter__()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost')

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.lifespan.__aexit__(None, None, None)
        self.environment.stop()

    async def provider(self, handler):
        await app.state.client.aclose()
        app.state.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def test_model_uses_disabled_thinking_and_only_agent_context(self):
        def handler(request):
            body = json.loads(request.content)
            self.assertEqual(body['model'], MODEL)
            self.assertEqual(body['thinking'], {'type': 'disabled'})
            self.assertEqual(body['response_format'], {'type': 'json_object'})
            self.assertEqual(request.headers['authorization'], 'Bearer test-only-secret')
            return httpx.Response(200, json={'choices': [{'message': {'content': '{"intent":"","action":{"type":"wait"}}'}}], 'model': MODEL, 'usage': {'prompt_tokens': 10, 'completion_tokens': 5}})
        await self.provider(handler)
        response = await self.client.post('/api/decision', json={'runId': 'test', 'decisionId': 'test:1', 'context': {'self': {'id': 1}}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['usage']['prompt_tokens'], 10)
        self.assertNotIn('test-only-secret', response.text)
        config = await self.client.get('/api/config')
        self.assertNotIn('test-only-secret', config.text)

    async def test_full_survey_has_a_bounded_larger_context_allowance(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}}]})
        await self.provider(handler)
        for survey, size, expected in [(None, 30000, 413), ({'radius': 3}, 30000, 200), ({'radius': 3}, 41000, 413)]:
            response = await self.client.post('/api/decision', json={
                'runId': 'test', 'decisionId': 'survey-size',
                'context': {'lastSurvey': survey, 'data': 'x' * size}})
            self.assertEqual(response.status_code, expected)
        self.assertEqual(len(calls), 1)

    async def test_prophet_receives_farming_guidance_only_on_action_requests(self):
        prompts = []
        def handler(request):
            prompts.append(json.loads(request.content)['messages'][0]['content'])
            return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}}]})
        await self.provider(handler)
        for role, kind in [('prophet', 'action'), (None, 'action'), ('prophet', 'reflection')]:
            response = await self.client.post('/api/decision', json={
                'runId': 'test', 'decisionId': 'farm-prompt', 'kind': kind,
                'context': {'self': {'id': 1, 'role': role}}})
            self.assertEqual(response.status_code, 200)
        self.assertIn('先知专属农耕知识', prompts[0])
        self.assertIn('累计执行3次terraform{}', prompts[0])
        self.assertIn('每个日末产3份食物', prompts[0])
        self.assertNotIn('先知专属农耕知识', prompts[1])
        self.assertNotIn('先知专属农耕知识', prompts[2])

    async def test_upstream_errors_are_sanitized(self):
        await self.provider(lambda _: httpx.Response(401, text='test-only-secret internal diagnostic'))
        response = await self.client.post('/api/decision', json={'runId': 'test', 'decisionId': 'test:1', 'context': {}})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('test-only-secret', response.text)

    async def test_oversized_context_is_rejected_before_provider(self):
        def handler(_):
            self.fail('Must not call provider')
        await self.provider(handler)
        response = await self.client.post('/api/decision', json={'runId': 'test', 'decisionId': 'test:1', 'context': {'text': 'x' * 24001}})
        self.assertEqual(response.status_code, 413)

    async def test_artifact_paths_cannot_escape_directory(self):
        response = await self.client.get('/api/experiments/.env/snapshot')
        self.assertEqual(response.status_code, 400)
        response = await self.client.get('/api/experiments/nonexistent-experiment/snapshot')
        self.assertEqual(response.status_code, 404)

    async def test_event_search_filters_full_committed_history_before_pagination(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'search'
            folder.mkdir()
            (folder / 'checkpoint.json').write_text(json.dumps({'world': {'seq': 250}}))
            events = [dict(seq=i, type='chat' if i in [5, 10, 251] else 'wait',
                           text='松说：一起合作 ABC' if i in [5, 10, 251] else '休息',
                           position=[2, 3], patch={'private': 'not needed'}) for i in range(1, 252)]
            (folder / 'events.jsonl').write_text(''.join(json.dumps(e) + '\n' for e in events) + '{')
            with patch('backend.app.main.ARTIFACTS', Path(directory)):
                for params in [{'event_type': 'chat'}, {'q': ' 对话 '}, {'q': 'abc'}, {'q': '合作', 'event_type': 'chat'}]:
                    response = await self.client.get('/api/experiments/search/events', params=params)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual([e['seq'] for e in response.json()['events']], [10, 5])
                    self.assertFalse(response.json()['hasMore'])
                    self.assertNotIn('patch', response.json()['events'][0])
                page = (await self.client.get('/api/experiments/search/events', params={'event_type': 'chat', 'limit': 1})).json()
                self.assertEqual([e['seq'] for e in page['events']], [10])
                self.assertTrue(page['hasMore'])
                historical = (await self.client.get('/api/experiments/search/events', params={'event_type': 'chat', 'through': 5})).json()
                self.assertEqual([e['seq'] for e in historical['events']], [5])
                empty = (await self.client.get('/api/experiments/search/events', params={'event_type': 'wait', 'q': '合作'})).json()
                self.assertEqual(empty['events'], [])

if __name__ == '__main__':
    unittest.main()
