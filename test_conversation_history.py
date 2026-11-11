"""Tests for multi-turn conversation history in council prompts."""

import sys
import types
import unittest

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
        pass


class DummyMessages:
    def __init__(self, *args, **kwargs):
        pass


gigachat_module.GigaChat = DummyGigaChat
gigachat_models_module.Chat = DummyChat
gigachat_models_module.Messages = DummyMessages
sys.modules.setdefault("gigachat", gigachat_module)
sys.modules.setdefault("gigachat.models", gigachat_models_module)
sys.modules.setdefault("dotenv", dotenv_module)
sys.modules.setdefault("httpx", httpx_module)

from backend.council import (
    apply_conversation_history,
    build_conversation_history_block,
    extract_conversation_turns,
    extract_stage3_answer,
)
from backend.config import MAX_USER_QUESTIONS_PER_CONVERSATION
from backend import storage


class ConversationHistoryTests(unittest.TestCase):
    def test_extract_stage3_answer_prefers_response(self):
        self.assertEqual(
            extract_stage3_answer({"response": " Final ", "content": "other"}),
            "Final",
        )
        self.assertEqual(extract_stage3_answer({"content": "Alt"}), "Alt")
        self.assertEqual(extract_stage3_answer(None), "")
        self.assertEqual(extract_stage3_answer({"response": "  "}), "")

    def test_extract_turns_empty_and_first_message(self):
        self.assertEqual(extract_conversation_turns(None), [])
        self.assertEqual(extract_conversation_turns({"messages": []}), [])
        self.assertEqual(
            extract_conversation_turns(
                {
                    "messages": [
                        {"role": "user", "content": "Only question so far"},
                    ]
                }
            ),
            [],
        )

    def test_extract_turns_skips_incomplete_assistant(self):
        conversation = {
            "messages": [
                {"role": "user", "content": "Q1"},
                {"role": "assistant", "stage3": None},
            ]
        }
        self.assertEqual(extract_conversation_turns(conversation), [])

    def test_extract_turns_accumulates_completed_pairs(self):
        conversation = {
            "messages": [
                {"role": "user", "content": "Q1"},
                {"role": "assistant", "stage3": {"response": "A1"}},
                {"role": "user", "content": "Q2"},
                {"role": "assistant", "stage3": {"response": "A2"}},
                {"role": "user", "content": "Q3 pending"},
            ]
        }
        self.assertEqual(
            extract_conversation_turns(conversation),
            [
                {"question": "Q1", "answer": "A1"},
                {"question": "Q2", "answer": "A2"},
            ],
        )

    def test_build_history_block_and_apply(self):
        turns = [
            {"question": "What is X?", "answer": "X is one."},
            {"question": "And Y?", "answer": "Y is two."},
        ]
        block = build_conversation_history_block(turns)
        self.assertIn("CONVERSATION SO FAR:", block)
        self.assertIn("### Turn 1", block)
        self.assertIn("User: What is X?", block)
        self.assertIn("Council answer: X is one.", block)
        self.assertIn("### Turn 2", block)
        self.assertIn("User: And Y?", block)
        self.assertIn("CURRENT QUESTION", apply_conversation_history("Follow up?", {
            "messages": [
                {"role": "user", "content": "What is X?"},
                {"role": "assistant", "stage3": {"response": "X is one."}},
                {"role": "user", "content": "And Y?"},
                {"role": "assistant", "stage3": {"response": "Y is two."}},
            ]
        }))

        result = apply_conversation_history(
            "Please compare both.",
            {
                "messages": [
                    {"role": "user", "content": "What is X?"},
                    {"role": "assistant", "stage3": {"response": "X is one."}},
                    {"role": "user", "content": "And Y?"},
                    {"role": "assistant", "stage3": {"response": "Y is two."}},
                ]
            },
        )
        self.assertTrue(result.startswith("CONVERSATION SO FAR:"))
        self.assertIn("CURRENT QUESTION:\nPlease compare both.", result)
        self.assertIn("X is one.", result)
        self.assertIn("Y is two.", result)

    def test_apply_noop_without_history(self):
        self.assertEqual(
            apply_conversation_history("Just a question", {"messages": []}),
            "Just a question",
        )
        self.assertEqual(apply_conversation_history("Just a question", None), "Just a question")

    def test_user_question_limit_is_three(self):
        self.assertEqual(MAX_USER_QUESTIONS_PER_CONVERSATION, 3)
        conversation = {
            "messages": [
                {"role": "user", "content": "q1"},
                {"role": "assistant", "stage3": {"response": "a1"}},
                {"role": "user", "content": "q2"},
                {"role": "assistant", "stage3": {"response": "a2"}},
                {"role": "user", "content": "q3"},
            ]
        }
        self.assertEqual(storage.count_user_messages(conversation), 3)
        self.assertGreaterEqual(
            storage.count_user_messages(conversation),
            MAX_USER_QUESTIONS_PER_CONVERSATION,
        )


if __name__ == "__main__":
    unittest.main()
