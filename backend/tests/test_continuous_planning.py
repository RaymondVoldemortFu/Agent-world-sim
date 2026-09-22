import json
import unittest
from backend.app.continuous_planning import Planner, PlanningError, summary_object


class PlanningTests(unittest.IsolatedAsyncioTestCase):
    def context(self):
        return {'prefix': [{'role': 'system', 'content': 'rules'}], 'tail': []}

    async def validate(self, raw):
        value = json.loads(raw)
        if not isinstance(value.get('intent'), str):
            raise ValueError('intent: expected string')
        return {'content': json.dumps(value), 'repairs': []}

    def planner(self, responses, calls, token_count=100):
        async def send(messages):
            calls.append(messages)
            reply = responses.pop(0)
            if isinstance(reply, Exception): raise reply
            return {'content': reply, 'usage': {'prompt_tokens': 10, 'completion_tokens': 2}, 'finish_reason': 'stop'}
        async def sleep(seconds): pass
        return Planner(send, self.validate, lambda _: token_count, 'compress', sleep)

    async def test_format_retry_preserves_prefix_and_persists_only_valid_content(self):
        calls, ctx = [], self.context()
        prefix = list(ctx['prefix'])
        result = await self.planner(['{"intent":12}', '{"intent":"取粮"}'], calls).run(ctx, 'observation', 10000)
        self.assertNotIn('error', result)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1][:len(calls[0])])
        self.assertIn('intent: expected string', calls[1][-1]['content'])
        self.assertEqual(ctx['prefix'], prefix)
        self.assertEqual(len(ctx['tail']), 2)
        self.assertEqual(json.loads(ctx['tail'][-1]['content'])['intent'], '取粮')
        self.assertEqual(result['usage']['prompt_tokens'], 20)
        self.assertEqual(result['attempts'][0]['content'], '{"intent":12}')

    async def test_compression_uses_history_as_data_and_corrects_wrong_plan_shape(self):
        calls, ctx = [], self.context()
        ctx['tail'] = [{'role': 'assistant', 'content': '{"intent":"旧计划"}'}]
        planner = self.planner(['{"intent":"错误的续写"}', '{"summary":"过去取过粮"}', '{"intent":"耕地"}'], calls, 8600)
        result = await planner.run(ctx, 'observation', 10000)
        self.assertNotIn('error', result)
        self.assertEqual(calls[0][-1]['role'], 'user')
        self.assertIn('旧计划', calls[0][-1]['content'])
        self.assertIn('summary', calls[1][-1]['content'])
        self.assertIn('过去取过粮', ctx['tail'][0]['content'])
        self.assertEqual(result['attempts'][0]['errorCode'], 'compression_format')
        self.assertEqual(len(result['attempts']), 3)

    async def test_transient_errors_retry_but_auth_errors_do_not(self):
        calls = []
        p = self.planner([PlanningError('transport_http', '503', True), '{"intent":"等待"}'], calls)
        result = await p.run(self.context(), 'observation', 10000)
        self.assertNotIn('error', result)
        self.assertEqual(len(calls), 2)
        p = self.planner([PlanningError('transport_http', '401')], [])
        result = await p.run(self.context(), 'observation', 10000)
        self.assertEqual(result['errorCode'], 'transport_http')
        self.assertEqual(len(result['attempts']), 1)

    async def test_exhaustion_has_specific_diagnostics_and_keeps_prior_context(self):
        ctx = self.context()
        result = await self.planner(['{"intent":3}'] * 3, []).run(ctx, 'observation', 10000)
        self.assertEqual(result['errorCode'], 'planning_format')
        self.assertEqual(len(result['attempts']), 3)
        self.assertEqual(ctx['tail'], [])

    async def test_failed_compaction_keeps_history_and_can_plan_with_headroom(self):
        ctx = self.context()
        old = {'role': 'user', 'content': '必须保留的旧经历'}
        ctx['tail'] = [old]
        result = await self.planner(['{}'] * 3 + ['{"intent":"取粮"}'], [], 8600).run(ctx, 'current', 10000)
        self.assertNotIn('error', result)
        self.assertIn('warnings', result)
        self.assertEqual(ctx['tail'][0], old)

    async def test_context_overflow_does_not_drop_uncompressed_history(self):
        ctx = self.context()
        ctx['tail'] = [{'role': 'user', 'content': '必须保留的旧经历'}]
        before = list(ctx['tail'])
        result = await self.planner(['{}'] * 3, [], 11000).run(ctx, 'current', 10000)
        self.assertEqual(result['errorCode'], 'context_overflow')
        self.assertEqual(ctx['tail'], before)

    def test_summary_formats_and_no_execution(self):
        self.assertEqual(summary_object("```json\n{\"summary\":\"摘要\"}\n```"), '摘要')
        self.assertEqual(summary_object("{'summary':'摘要'}"), '摘要')
        for value in ['{"summary":42}', '{"intent":"新计划"}', '__import__("os").getcwd()', '{"summary":"未结束']:
            with self.assertRaises((ValueError, SyntaxError)):
                summary_object(value)
