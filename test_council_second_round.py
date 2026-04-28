import tempfile
import types
import unittest
import sys
import re
from pathlib import Path
from unittest.mock import AsyncMock, patch

gigachat_module = types.ModuleType("gigachat")
gigachat_models_module = types.ModuleType("gigachat.models")
dotenv_module = types.ModuleType("dotenv")
httpx_module = types.ModuleType("httpx")
dotenv_module.load_dotenv = lambda *args, **kwargs: None
httpx_module.AsyncClient = object
httpx_module.TimeoutException = TimeoutError


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
sys.modules.setdefault("dotenv", dotenv_module)
sys.modules.setdefault("httpx", httpx_module)

from backend import storage
from backend.agora_eval_files import resolve_eval_file
from backend.council import (
    get_peer_ranking_models,
    is_valid_agora_evaluation,
    parse_agora_scores_from_text,
    parse_ranking_from_text,
    run_full_council,
    select_second_round_finalists,
    stage1_collect_responses,
    stage2_collect_rankings,
    stage3_synthesize_final,
)


def ranking_text(labels):
    body = "\n".join(f"{label} looks solid." for label in labels)
    ranking = "\n".join(f"{index}. {label}" for index, label in enumerate(labels, start=1))
    return f"{body}\n\nFINAL RANKING:\n{ranking}"


class CouncilSecondRoundTests(unittest.IsolatedAsyncioTestCase):
    @patch("backend.council.query_models_parallel", new_callable=AsyncMock)
    async def test_stage1_preserves_rag_context_metadata(self, mock_query_models_parallel):
        mock_query_models_parallel.return_value = {
            "agora/rag": {
                "content": "RAG-backed answer",
                "rag_context": "Retrieved source context",
            },
            "model-b": {"content": "Plain answer"},
            "model-empty": {"content": "  "},
        }

        results = await stage1_collect_responses(
            "Question",
            models=["agora/rag", "model-b", "model-empty"],
        )

        by_model = {item["model"]: item for item in results}
        self.assertEqual(by_model["agora/rag"]["response"], "RAG-backed answer")
        self.assertEqual(by_model["agora/rag"]["rag_context"], "Retrieved source context")
        self.assertNotIn("rag_context", by_model["model-b"])
        self.assertNotIn("model-empty", by_model)

    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    async def test_stage2_prompt_includes_anonymized_rag_context(self, mock_query_model_messages_parallel):
        mock_query_model_messages_parallel.return_value = {
            "judge-model": {"content": ranking_text(["Response A", "Response B"])}
        }
        stage1_results = [
            {
                "model": "agora/rag",
                "response": "RAG-backed answer",
                "rag_context": "Retrieved source context",
            },
            {"model": "openai/example", "response": "Plain answer"},
        ]

        await stage2_collect_rankings(
            "Question",
            stage1_results,
            models=["judge-model"],
        )

        model_messages = mock_query_model_messages_parallel.await_args.args[0]
        messages = model_messages["judge-model"]
        prompt = messages[0]["content"]
        self.assertIn("RAG EVIDENCE CONTEXT:", prompt)
        self.assertIn("<rag_evidence_context>", prompt)
        self.assertIn("<instructions>", prompt)
        self.assertIn("<context_data>", prompt)
        self.assertIn("</context_data>", prompt)
        self.assertIn("</rag_evidence_context>", prompt)
        self.assertIn("Response A RAG context:", prompt)
        self.assertIn("Retrieved source context", prompt)
        self.assertIn("Do not rank a response higher only because RAG context exists", prompt)
        self.assertIn("Context alignment:", prompt)
        self.assertIn("Brevity is not a quality signal by itself", prompt)
        self.assertIn("prefer rich, well-structured answers with relevant details", prompt)
        self.assertNotIn("agora/rag", prompt)
        self.assertNotIn("openai/example", prompt)

    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    async def test_stage2_sends_agora_file_urls_for_peer_ranking(self, mock_query_model_messages_parallel):
        observed_tmp_dirs = []

        async def fake_query(model_messages, on_model_complete=None, timeout=None):
            self.assertEqual(set(model_messages), {"agora/rag", "openai/example"})
            self.assertEqual(timeout, 300.0)

            standard_prompt = model_messages["openai/example"][0]["content"]
            self.assertIn("RAG-backed answer", standard_prompt)
            self.assertIn("Plain answer", standard_prompt)

            agora_prompt = model_messages["agora/rag"][0]["content"]
            self.assertIn("Agora's RAG prefetch layer can fetch them", agora_prompt)
            self.assertIn("https://api.arteus.us/council/api/agora-eval-files/", agora_prompt)
            self.assertIn("<resource_fetcher_results>", agora_prompt)
            self.assertIn("<resource_fetcher_result ...>", agora_prompt)
            self.assertIn("<resource_fetcher_summary>", agora_prompt)
            self.assertIn("<resource_fetcher_sources>", agora_prompt)
            self.assertIn("<resource ...>", agora_prompt)
            self.assertIn("Do not try to call a tool yourself", agora_prompt)
            self.assertIn("AGORA EVALUATION UNAVAILABLE: missing fetched response resources", agora_prompt)
            self.assertIn("do not ask the user to send files", agora_prompt)
            self.assertIn("Context alignment:", agora_prompt)
            self.assertIn("## RAG context sections", agora_prompt)
            self.assertIn("Brevity is not a quality signal by itself", agora_prompt)
            self.assertIn("prefer rich, well-structured answers with relevant details", agora_prompt)
            self.assertIn("Do not return JSON", agora_prompt)
            self.assertNotIn("RAG-backed answer", agora_prompt)
            self.assertNotIn("Plain answer", agora_prompt)

            url_matches = re.findall(
                r"https://api\.arteus\.us/council/api/agora-eval-files/([^\s/]+)/response_([A-Z])\.md",
                agora_prompt,
            )
            paths = [
                resolve_eval_file(token, f"response_{suffix}.md")
                for token, suffix in url_matches
            ]
            self.assertEqual(len(paths), 2)
            self.assertNotIn(None, paths)
            observed_tmp_dirs.extend({path.parent for path in paths})
            by_name = {path.name: path.read_text(encoding="utf-8") for path in paths}
            self.assertIn("# Response A", by_name["response_A.md"])
            self.assertIn("RAG-backed answer", by_name["response_A.md"])
            self.assertIn("## RAG context", by_name["response_A.md"])
            self.assertIn("Retrieved source context", by_name["response_A.md"])
            self.assertIn("# Response B", by_name["response_B.md"])
            self.assertIn("Plain answer", by_name["response_B.md"])

            if on_model_complete:
                on_model_complete("agora/rag", {"content": "done"})
                on_model_complete("openai/example", {"content": "done"})

            return {
                "agora/rag": {
                    "content": (
                        "AGORA EVALUATION:\n"
                        "Response A | score: 9 | rank: 1 | note: grounded\n"
                        "Response B | score: 6 | rank: 2 | note: thinner"
                    )
                },
                "openai/example": {"content": ranking_text(["Response A", "Response B"])},
            }

        mock_query_model_messages_parallel.side_effect = fake_query
        stage1_results = [
            {
                "model": "agora/rag",
                "response": "RAG-backed answer",
                "rag_context": "Retrieved source context",
            },
            {"model": "openai/example", "response": "Plain answer"},
        ]

        stage2_results, label_to_model = await stage2_collect_rankings(
            "Question",
            stage1_results,
            models=["agora/rag", "openai/example"],
        )

        self.assertEqual(label_to_model["Response A"], "agora/rag")
        self.assertEqual(len(stage2_results), 2)
        by_model = {result["model"]: result for result in stage2_results}
        self.assertEqual(by_model["agora/rag"]["parsed_ranking"], ["Response A", "Response B"])
        self.assertEqual(
            by_model["agora/rag"]["parsed_scores"],
            [
                {"label": "Response A", "score": 9, "rank": 1, "note": "grounded"},
                {"label": "Response B", "score": 6, "rank": 2, "note": "thinner"},
            ],
        )
        self.assertTrue(observed_tmp_dirs)
        for tmp_dir in observed_tmp_dirs:
            self.assertFalse(tmp_dir.exists())

    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    async def test_stage2_allows_only_agora_to_judge(self, mock_query_model_messages_parallel):
        mock_query_model_messages_parallel.return_value = {
            "agora/rag": {
                "content": (
                    "AGORA EVALUATION:\n"
                    "Response A | score: 8 | rank: 1 | note: only answer"
                )
            }
        }
        stage1_results = [
            {"model": "agora/rag", "response": "RAG-backed answer"},
        ]

        stage2_results, label_to_model = await stage2_collect_rankings(
            "Question",
            stage1_results,
            models=["agora/rag"],
        )

        self.assertEqual(stage2_results[0]["model"], "agora/rag")
        self.assertEqual(stage2_results[0]["parsed_ranking"], ["Response A"])
        self.assertEqual(label_to_model, {"Response A": "agora/rag"})
        mock_query_model_messages_parallel.assert_awaited_once()

    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    async def test_stage2_skips_invalid_agora_evaluation(self, mock_query_model_messages_parallel):
        invalid_agora_response = (
            "В текущем контексте нет самих текстов response_A.md ... response_B.md. "
            "Пришли, пожалуйста, блоки с содержимым response_A.md ... response_B.md."
        )
        mock_query_model_messages_parallel.return_value = {
            "agora/rag": {"content": invalid_agora_response},
            "openai/example": {"content": ranking_text(["Response A", "Response B"])},
        }
        stage1_results = [
            {"model": "agora/rag", "response": "RAG-backed answer"},
            {"model": "openai/example", "response": "Plain answer"},
        ]

        stage2_results, _ = await stage2_collect_rankings(
            "Question",
            stage1_results,
            models=["agora/rag", "openai/example"],
        )

        self.assertEqual([result["model"] for result in stage2_results], ["openai/example"])

    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    async def test_stage2_does_not_send_empty_response_files_to_agora(self, mock_query_model_messages_parallel):
        async def fake_query(model_messages, on_model_complete=None, timeout=None):
            self.assertEqual(set(model_messages), {"openai/example"})
            self.assertNotIn("agora/rag", model_messages)
            return {
                "openai/example": {"content": ranking_text(["Response B", "Response A"])},
            }

        mock_query_model_messages_parallel.side_effect = fake_query
        stage1_results = [
            {"model": "agora/rag", "response": ""},
            {"model": "openai/example", "response": "Plain answer"},
        ]

        stage2_results, _ = await stage2_collect_rankings(
            "Question",
            stage1_results,
            models=["agora/rag", "openai/example"],
        )

        self.assertEqual([result["model"] for result in stage2_results], ["openai/example"])

    def test_get_peer_ranking_models_keeps_agora(self):
        self.assertEqual(
            get_peer_ranking_models(["agora/rag", "openai/example", "agora/custom"]),
            ["agora/rag", "openai/example", "agora/custom"],
        )

    def test_parse_agora_scores_and_rank_fallback(self):
        ranking = (
            "AGORA EVALUATION:\n"
            "Response B | score: 7.5 | rank: 2 | note: useful but incomplete\n"
            "Response A | score: 9 | rank: 1 | note: best grounded answer"
        )

        self.assertEqual(
            parse_agora_scores_from_text(ranking),
            [
                {"label": "Response B", "score": 7.5, "rank": 2, "note": "useful but incomplete"},
                {"label": "Response A", "score": 9, "rank": 1, "note": "best grounded answer"},
            ],
        )
        self.assertEqual(parse_ranking_from_text(ranking), ["Response A", "Response B"])
        self.assertTrue(is_valid_agora_evaluation(ranking, ["Response A", "Response B"]))
        self.assertFalse(is_valid_agora_evaluation(ranking, ["Response A", "Response B", "Response C"]))

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
        revised_dict = {
            model: {"content": f"revised {model}"}
            for model in finalists
        }
        mock_query_models_parallel.return_value = stage1_dict
        mock_query_model_messages_parallel.side_effect = [
            stage2_dict,
            revised_dict,
            round2_stage2_dict,
        ]
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
    @patch("backend.council.query_model_messages_parallel", new_callable=AsyncMock)
    @patch("backend.council.query_models_parallel", new_callable=AsyncMock)
    async def test_run_full_council_without_second_round(
        self,
        mock_query_models_parallel,
        mock_query_model_messages_parallel,
        mock_query_model,
    ):
        models = ["model-a", "model-b", "model-c"]
        mock_query_models_parallel.return_value = {
            model: {"content": f"draft {model}"} for model in models
        }
        mock_query_model_messages_parallel.return_value = {
            model: {"content": ranking_text(["Response A", "Response B", "Response C"])} for model in models
        }
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

    @patch("backend.council.query_model", new_callable=AsyncMock)
    async def test_stage3_retries_empty_final_synthesis(self, mock_query_model):
        mock_query_model.side_effect = [
            {"content": "   "},
            None,
            {"content": "final synthesis after retry"},
        ]

        result = await stage3_synthesize_final(
            "Question",
            stage1_results=[{"model": "model-a", "response": "draft answer"}],
            stage2_results=[{"model": "model-b", "ranking": ranking_text(["Response A"])}],
            chairman_model="chair-model",
        )

        self.assertEqual(result["model"], "chair-model")
        self.assertEqual(result["response"], "final synthesis after retry")
        self.assertEqual(mock_query_model.await_count, 3)


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
