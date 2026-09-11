import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from backend.app import context_engine as ce
from backend.app.main import app, decision, DecisionRequest
from backend.tests import test_context_engine as fixtures

observation = fixtures.observation


class ThinkingTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_deep_reflection_enables_thinking(self):
        post = AsyncMock(
            return_value=SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "choices": [{"message": {"content": '{"intent":"test"}'}}],
                    "usage": {},
                },
            )
        )

        async def decide(req, model, send):
            for purpose in ["decision", "compression", "deep_reflection"]:
                await send([{"role": "user", "content": "JSON"}], purpose)
            return {"ok": True}

        with (
            patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test"}),
            patch.object(ce, "decide", decide),
            patch.object(app.state, "client", SimpleNamespace(post=post), create=True),
            patch.object(app.state, "semaphore", asyncio.Semaphore(1), create=True),
        ):
            await decision(
                DecisionRequest(
                    runId="test", decisionId="test", context={"protocol": "context-1"}
                )
            )
        self.assertEqual(
            [c.kwargs["json"]["thinking"]["type"] for c in post.call_args_list],
            ["disabled", "disabled", "enabled"],
        )
        self.assertEqual(post.call_args_list[-1].kwargs["timeout"], 240.0)
        for call in post.call_args_list:
            self.assertTrue(
                {"max_tokens", "max_completion_tokens", "max_output_tokens"}.isdisjoint(
                    call.kwargs["json"]
                )
            )


@unittest.skipUnless(os.getenv("MYSQL_TEST") == "1", "requires project database")
class ReflectionContextTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixtures.ContextTests.asyncSetUp
    asyncTearDown = fixtures.ContextTests.asyncTearDown
    request = fixtures.ContextTests.request
    provider = fixtures.ContextTests.provider

    async def test_reflection_keeps_prefix_and_is_idempotent(self):
        o = observation()
        first = await ce.decide(self.request(o), "test", self.provider)
        prefix = ce.fixed(o)
        o.update(
            day=10,
            seq=2,
            deepReflection=True,
            contextHead=first["contextTrace"]["turnId"],
        )
        self.assertEqual(prefix, ce.fixed(o))
        calls = []

        async def provider(messages, purpose):
            calls.append((messages, purpose))
            return {
                "status": 200,
                "purpose": purpose,
                "content": json.dumps(
                    {
                        "intent": "协作",
                        "reflection": {
                            "summary": "近期资源紧缺",
                            "plan": "与邻居合作生产工具",
                        },
                    }
                ),
                "usage": {},
            }

        result = await ce.decide(self.request(o), "test", provider)
        self.assertEqual(calls[-1][1], "deep_reflection")
        self.assertIn("十日深度反思", calls[-1][0][-1]["content"])
        self.assertEqual(calls[-1][0][: len(prefix)], prefix)
        repeated = await ce.decide(self.request(o), "test", provider)
        self.assertEqual(result, repeated)
        self.assertEqual(len(calls), 1)


class OutputTransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_decision_and_news_do_not_send_output_caps_or_slice_text(self):
        from backend.app import news

        text = "完整输出" * 2000
        post = AsyncMock(
            return_value=SimpleNamespace(
                status_code=200,
                json=lambda: {
                    "choices": [
                        {"finish_reason": "stop", "message": {"content": text}}
                    ],
                    "usage": {"completion_tokens": 5000},
                },
            )
        )
        with (
            patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test"}),
            patch.object(app.state, "client", SimpleNamespace(post=post), create=True),
            patch.object(app.state, "semaphore", asyncio.Semaphore(1), create=True),
            patch.object(news.s, "transaction"),
        ):
            result = await decision(
                DecisionRequest(runId="test", decisionId="test", context={})
            )
            self.assertEqual(result["content"], text)
            article = await news.provider(
                app,
                "transport-test",
                1,
                [{"role": "user", "content": "当天事实"}],
                "news",
            )
            self.assertEqual(article, text)
        self.assertEqual(post.call_count, 2)
        for call in post.call_args_list:
            self.assertTrue(
                {"max_tokens", "max_completion_tokens", "max_output_tokens"}.isdisjoint(
                    call.kwargs["json"]
                )
            )
