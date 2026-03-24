import tempfile
import types
import unittest
import sys
from unittest.mock import AsyncMock, patch

gigachat_module = types.ModuleType("gigachat")
gigachat_models_module = types.ModuleType("gigachat.models")


class DummyGigaChat:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class DummyChat:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


class DummyMessages:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


gigachat_module.GigaChat = DummyGigaChat
gigachat_models_module.Chat = DummyChat
gigachat_models_module.Messages = DummyMessages
sys.modules.setdefault("gigachat", gigachat_module)
sys.modules.setdefault("gigachat.models", gigachat_models_module)

from backend import storage
from backend.council import run_full_council, select_second_round_finalists


def ranking_text(labels):
    body = "\n".join(f"{label} looks solid." for label in labels)
    ranking = "\n".join(f"{index}. {label}" for index, label in enumerate(labels, start=1))
    return f"{body}\n\nFINAL RANKING:\n{ranking}"


class CouncilSecondRoundTests(unittest.IsolatedAsyncioTestCase):
    def test_select_second_round_finalists_uses_dynamic_cutoff(self):
        stage1_results = [
            {"model": f"model-{index}", "response": f"response-{index}"}
            for index in range(1, 7)
        ]
        aggregate_rankings = [
            {"model": f"model-{index}", "average_rank": float(index), "rankings_count": 6}
            for index in range(1, 7)
        ]

        finalists = select_second_round_finalists(stage1_results, aggregate_rankings)

        self.assertEqual(finalists, ["model-1", "model-2", "model-3"])

    @patch("backend.council.query_model", new_callable=AsyncMock)
    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    @patch("backend.council.query_models_parallel", new_callable=AsyncMock)
    async def test_run_full_council_second_round_completed(
        self,
        mock_query_models_parallel,
        mock_query_model_messages_parallel,
        mock_query_model,
    ):
        models = [f"model-{index}" for index in range(1, 6)]
        stage1_dict = {
            model: {"content": f"draft from {model}"}
            for model in models
        }
        stage2_dict = {
            model: {"content": ranking_text([
                "Response A",
                "Response B",
                "Response C",
                "Response D",
                "Response E",
            ])}
            for model in models
        }
        finalists = ["model-1", "model-2", "model-3"]
        round2_stage2_dict = {
            model: {"content": ranking_text([
                "Response A",
                "Response B",
                "Response C",
            ])}
            for model in finalists
        }
        mock_query_models_parallel.side_effect = [
            stage1_dict,
            stage2_dict,
            round2_stage2_dict,
        ]
        mock_query_model_messages_parallel.return_value = {
            model: {"content": f"revised {model}"}
            for model in finalists
        }
        mock_query_model.return_value = {"content": "final synthesis"}

        stage1_results, stage2_results, stage3_result, metadata, rounds = await run_full_council(
            "Explain the topic",
            models=models,
            enable_second_round=True,
        )

        self.assertEqual(len(stage1_results), 5)
        self.assertEqual(len(stage2_results), 5)
        self.assertEqual(stage3_result["response"], "final synthesis")
        self.assertEqual(metadata["second_round_status"], "completed")
        self.assertEqual(metadata["round2_finalists"], finalists)
        self.assertEqual(len(rounds), 2)
        self.assertEqual(rounds[1]["round"], 2)
        self.assertEqual([item["model"] for item in rounds[1]["stage1"]], finalists)
        self.assertEqual(len(rounds[1]["stage2"]), 3)

    @patch("backend.council.query_model", new_callable=AsyncMock)
    @patch("backend.council.query_models_parallel", new_callable=AsyncMock)
    async def test_run_full_council_without_second_round(
        self,
        mock_query_models_parallel,
        mock_query_model,
    ):
        models = ["model-a", "model-b", "model-c"]
        mock_query_models_parallel.side_effect = [
            {model: {"content": f"draft {model}"} for model in models},
            {model: {"content": ranking_text(["Response A", "Response B", "Response C"])} for model in models},
        ]
        mock_query_model.return_value = {"content": "single round synthesis"}

        _, _, stage3_result, metadata, rounds = await run_full_council(
            "What changed?",
            models=models,
            enable_second_round=False,
        )

        self.assertEqual(stage3_result["response"], "single round synthesis")
        self.assertFalse(metadata["second_round_enabled"])
        self.assertEqual(metadata["second_round_status"], "skipped")
        self.assertEqual(len(rounds), 1)


class StorageAssistantMessageTests(unittest.TestCase):
    def test_add_assistant_message_persists_metadata_rounds_and_scraped_links(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(storage, "DATA_DIR", tmpdir):
                storage.create_conversation("session", "conv")
                storage.add_assistant_message(
                    "session",
                    "conv",
                    stage1=[{"model": "m1", "response": "r1"}],
                    stage2=[{"model": "m1", "ranking": "rank", "parsed_ranking": []}],
                    stage3={"model": "chair", "response": "final"},
                    metadata={"second_round_enabled": True},
                    rounds=[{"round": 1, "stage1": [], "stage2": [], "metadata": {}}],
                    scraped_links=[{"url": "https://example.com"}],
                )

                saved = storage.get_conversation("session", "conv")
                assistant = saved["messages"][0]
                self.assertEqual(assistant["metadata"]["second_round_enabled"], True)
                self.assertEqual(assistant["rounds"][0]["round"], 1)
                self.assertEqual(assistant["scrapedLinks"][0]["url"], "https://example.com")


if __name__ == "__main__":
    unittest.main()
