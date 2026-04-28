import json
import sys
import types
import unittest
from unittest.mock import AsyncMock, patch

try:
    import httpx
except ModuleNotFoundError:
    httpx = types.ModuleType("httpx")

class Request:
    def __init__(self, method, url):
        self.method = method
        self.url = url


class Response:
    def __init__(self, status_code, request=None):
        self.status_code = status_code
        self.request = request


class HTTPStatusError(Exception):
    def __init__(self, message, request=None, response=None):
        super().__init__(message)
        self.request = request
        self.response = response


if not hasattr(httpx, "Request"):
    httpx.Request = Request
if not hasattr(httpx, "Response"):
    httpx.Response = Response
if not hasattr(httpx, "HTTPStatusError"):
    httpx.HTTPStatusError = HTTPStatusError
if not hasattr(httpx, "TimeoutException"):
    httpx.TimeoutException = TimeoutError
if not hasattr(httpx, "AsyncClient"):
    httpx.AsyncClient = object
sys.modules.setdefault("httpx", httpx)

gigachat_module = types.ModuleType("gigachat")
gigachat_models_module = types.ModuleType("gigachat.models")
gigachat_module.GigaChat = object
gigachat_models_module.Chat = object
gigachat_models_module.Messages = object
sys.modules.setdefault("gigachat", gigachat_module)
sys.modules.setdefault("gigachat.models", gigachat_models_module)

dotenv_module = types.ModuleType("dotenv")
dotenv_module.load_dotenv = lambda *args, **kwargs: None
sys.modules.setdefault("dotenv", dotenv_module)

from backend import agora_adapter
from backend.llm import query_model as dispatch_query_model


class MockResponse:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code
        self.request = httpx.Request("GET", "https://example.test")
        self.response = httpx.Response(status_code, request=self.request)

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=self.request, response=self.response)


class FakeAsyncClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, **kwargs):
        self.calls.append(("POST", url, kwargs))
        return self.responses.pop(0)

    async def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return self.responses.pop(0)


class AgoraAdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_api_key_returns_none(self):
        with patch.object(agora_adapter, "AGORA_API_KEY", ""):
            with patch("backend.agora_adapter.httpx.AsyncClient") as mock_client:
                response = await agora_adapter.query_model(
                    "agora/rag",
                    [{"role": "user", "content": "Hello"}],
                )

        self.assertIsNone(response)
        mock_client.assert_not_called()

    async def test_successful_session_predict_poll_returns_content(self):
        fake_client = FakeAsyncClient(
            [
                MockResponse({"session_id": "session-1", "request_id": "session-request"}),
                MockResponse({"request_id": "request-1", "input_text": "Final question?", "status": "pending"}),
                MockResponse(
                    {
                        "request_id": "request-1",
                        "input_text": "Final question?",
                        "output_text": "Agora answer",
                        "context": [{"source": "doc", "text": "Agora source"}],
                        "status": "final",
                    }
                ),
            ]
        )

        messages = [
            {"role": "system", "content": "Use terse answers."},
            {"role": "user", "content": "Earlier question"},
            {"role": "assistant", "content": "Earlier answer"},
            {"role": "user", "content": "Final question?"},
        ]

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch.object(agora_adapter, "AGORA_API_BASE_URL", "https://agora.example/agora/v1"):
                with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                    response = await agora_adapter.query_model("agora/rag", messages, timeout=5)

        self.assertEqual(
            response,
            {
                "content": "Agora answer",
                "reasoning_details": "",
                "rag_context": json.dumps([{"source": "doc", "text": "Agora source"}], ensure_ascii=False),
            },
        )
        self.assertEqual([call[0] for call in fake_client.calls], ["POST", "POST", "GET"])
        self.assertEqual(fake_client.calls[0][1], "https://agora.example/agora/v1/sessions")
        self.assertEqual(fake_client.calls[1][1], "https://agora.example/agora/v1/predict")
        self.assertEqual(fake_client.calls[2][1], "https://agora.example/agora/v1/predict/request-1")
        self.assertEqual(fake_client.calls[2][2]["params"], {"include_context": True})

        session_payload = fake_client.calls[0][2]["json"]
        self.assertEqual(session_payload["user_id"], "llm-council")
        self.assertEqual(session_payload["bot_id"], "agora")
        self.assertIn("SYSTEM: Use terse answers.", session_payload["conversation_context"])
        self.assertIn("USER: Earlier question", session_payload["conversation_context"])
        self.assertNotIn("Final question?", session_payload["conversation_context"])
        self.assertEqual(
            session_payload["user_vars"],
            {"source": "llm-council", "from_council": True, "council_model_id": "agora/rag"},
        )

        predict_payload = fake_client.calls[1][2]["json"]
        self.assertTrue(predict_payload["input_text"].startswith("Final question?\n\nAGORA DETAIL INSTRUCTION:"))
        self.assertIn("Provide the most detailed answer possible", predict_payload["input_text"])
        self.assertIn("Do not end with offers to continue in a later message", predict_payload["input_text"])
        self.assertIn("include it now in the current answer instead of offering it for later", predict_payload["input_text"])
        self.assertEqual(predict_payload["session_id"], "session-1")
        self.assertFalse(predict_payload["wait"])
        self.assertEqual(fake_client.calls[1][2]["headers"]["Authorization"], "Bearer test-key")

    async def test_output_text_object_is_serialized_without_ascii_escaping(self):
        fake_client = FakeAsyncClient(
            [
                MockResponse({"session_id": "session-1"}),
                MockResponse({"request_id": "request-1", "input_text": "Question", "status": "pending"}),
                MockResponse(
                    {
                        "request_id": "request-1",
                        "input_text": "Question",
                        "output_text": {"answer": "Привет"},
                        "status": "final",
                    }
                ),
            ]
        )

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                response = await agora_adapter.query_model(
                    "agora/rag",
                    [{"role": "user", "content": "Question"}],
                    timeout=5,
                )

        self.assertEqual(response["content"], json.dumps({"answer": "Привет"}, ensure_ascii=False))

    async def test_output_text_list_is_serialized_without_ascii_escaping(self):
        fake_client = FakeAsyncClient(
            [
                MockResponse({"session_id": "session-1"}),
                MockResponse({"request_id": "request-1", "input_text": "Question", "status": "pending"}),
                MockResponse(
                    {
                        "request_id": "request-1",
                        "input_text": "Question",
                        "output_text": [{"text": "Привет"}, {"text": "мир"}],
                        "status": "final",
                    }
                ),
            ]
        )

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                response = await agora_adapter.query_model(
                    "agora/rag",
                    [{"role": "user", "content": "Question"}],
                    timeout=5,
                )

        self.assertEqual(response["content"], json.dumps([{"text": "Привет"}, {"text": "мир"}], ensure_ascii=False))

    async def test_pipeline_resource_fetcher_context_is_returned(self):
        fake_client = FakeAsyncClient(
            [
                MockResponse({"session_id": "session-1"}),
                MockResponse({"request_id": "request-1", "input_text": "Question", "status": "pending"}),
                MockResponse(
                    {
                        "request_id": "request-1",
                        "input_text": "Question",
                        "output_text": "Agora answer",
                        "context": [{"source": "doc", "text": "Vector context"}],
                        "pipeline": {
                            "outputs": [
                                {
                                    "agent/resource_fetcher": (
                                        "<resource_fetcher_results>Fetched file text</resource_fetcher_results>"
                                    ),
                                    "agent/context_summaries": "<section_summary>Summary</section_summary>",
                                }
                            ]
                        },
                        "status": "final",
                    }
                ),
            ]
        )

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                response = await agora_adapter.query_model(
                    "agora/rag",
                    [{"role": "user", "content": "Question"}],
                    timeout=5,
                )

        self.assertIn("Vector context", response["rag_context"])
        self.assertIn("agent/resource_fetcher:", response["rag_context"])
        self.assertIn("Fetched file text", response["rag_context"])
        self.assertIn("agent/context_summaries:", response["rag_context"])
        self.assertIn("Summary", response["rag_context"])

    async def test_pending_until_timeout_returns_none(self):
        fake_client = FakeAsyncClient(
            [
                MockResponse({"session_id": "session-1"}),
                MockResponse({"request_id": "request-1", "input_text": "Question", "status": "pending"}),
            ]
            + [
                MockResponse({"request_id": "request-1", "input_text": "Question", "status": "pending"})
                for _ in range(20)
            ]
        )

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch.object(agora_adapter, "AGORA_POLL_INTERVAL_SECONDS", 0.001):
                with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                    response = await agora_adapter.query_model(
                        "agora/rag",
                        [{"role": "user", "content": "Question"}],
                        timeout=0.003,
                    )

        self.assertIsNone(response)

    async def test_http_error_returns_none(self):
        fake_client = FakeAsyncClient([MockResponse({"detail": "bad"}, status_code=500)])

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                response = await agora_adapter.query_model(
                    "agora/rag",
                    [{"role": "user", "content": "Question"}],
                    timeout=5,
                )

        self.assertIsNone(response)

    async def test_missing_request_id_returns_none(self):
        fake_client = FakeAsyncClient(
            [
                MockResponse({"session_id": "session-1"}),
                MockResponse({"input_text": "Question", "status": "pending"}),
            ]
        )

        with patch.object(agora_adapter, "AGORA_API_KEY", "test-key"):
            with patch("backend.agora_adapter.httpx.AsyncClient", return_value=fake_client):
                response = await agora_adapter.query_model(
                    "agora/rag",
                    [{"role": "user", "content": "Question"}],
                    timeout=5,
                )

        self.assertIsNone(response)


class LlmDispatcherTests(unittest.IsolatedAsyncioTestCase):
    async def test_agora_model_routes_to_agora_adapter(self):
        messages = [{"role": "user", "content": "Question"}]
        expected = {"content": "Answer", "reasoning_details": ""}

        with patch("backend.llm.agora_adapter.query_model", new_callable=AsyncMock) as mock_query:
            mock_query.return_value = expected

            response = await dispatch_query_model("agora/rag", messages, timeout=12)

        self.assertEqual(response, expected)
        mock_query.assert_awaited_once_with("agora/rag", messages, 12)


if __name__ == "__main__":
    unittest.main()
