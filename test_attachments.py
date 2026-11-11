import unittest

from backend.attachments import (
    MAX_ATTACHMENT_TOKENS,
    build_agora_attachment_block,
    build_inline_attachment_block,
    cleanup_attachment_files,
    create_attachment_files,
    estimate_attachments_tokens,
    estimate_tokens,
    normalize_attachments,
    validate_attachments,
)
from backend.agora_eval_files import resolve_eval_file


class EstimateTokensTests(unittest.TestCase):
    def test_empty_text(self):
        self.assertEqual(estimate_tokens(""), 0)

    def test_ascii_text(self):
        # 100 ASCII chars * 0.25 = 25
        self.assertEqual(estimate_tokens("a" * 100), 25)

    def test_non_ascii_text(self):
        # 100 Cyrillic chars * 0.45 = 45
        self.assertEqual(estimate_tokens("п" * 100), 45)

    def test_mixed_text(self):
        # 100 ASCII * 0.25 + 100 Cyrillic * 0.45 = 25 + 45 = 70
        self.assertEqual(estimate_tokens("a" * 100 + "п" * 100), 70)

    def test_minimum_one_token(self):
        self.assertEqual(estimate_tokens("a"), 1)


class ValidateAttachmentsTests(unittest.TestCase):
    def test_valid_markdown(self):
        validate_attachments([{"name": "notes.md", "content": "# Hello"}])

    def test_valid_txt(self):
        validate_attachments([{"name": "data.txt", "content": "plain text"}])

    def test_valid_pdf(self):
        validate_attachments([{"name": "report.pdf", "content": "extracted text"}])

    def test_rejects_non_markdown(self):
        with self.assertRaises(ValueError) as ctx:
            validate_attachments([{"name": "doc.docx", "content": "abc"}])
        self.assertIn("Только .md", str(ctx.exception))
        self.assertIn("doc.docx", str(ctx.exception))

    def test_rejects_over_budget_total(self):
        # 600k ASCII chars * 0.25 = 150k tokens > 100k budget
        with self.assertRaises(ValueError) as ctx:
            validate_attachments([{"name": "big.md", "content": "a" * 600_000}])
        message = str(ctx.exception)
        self.assertIn("Не жируй", message)
        self.assertIn("max thinking effort", message)

    def test_budget_is_total_across_files(self):
        # Two files of 300k ASCII chars each: 75k + 75k = 150k > 100k
        with self.assertRaises(ValueError):
            validate_attachments([
                {"name": "a.md", "content": "a" * 300_000},
                {"name": "b.md", "content": "b" * 300_000},
            ])

    def test_accepts_exactly_at_budget(self):
        # 400k ASCII chars * 0.25 = exactly 100k tokens
        validate_attachments([{"name": "ok.md", "content": "a" * 400_000}])

    def test_estimate_attachments_tokens(self):
        attachments = [
            {"name": "a.md", "content": "a" * 100},
            {"name": "b.md", "content": "п" * 100},
        ]
        self.assertEqual(estimate_attachments_tokens(attachments), 25 + 45)


class NormalizeAttachmentsTests(unittest.TestCase):
    def test_strips_empty_and_nameless(self):
        attachments = normalize_attachments([
            {"name": "keep.md", "content": "text"},
            {"name": "empty.md", "content": "   "},
            {"name": "  ", "content": "text"},
        ])
        self.assertEqual(attachments, [{"name": "keep.md", "content": "text"}])


class PromptBlockTests(unittest.TestCase):
    def test_inline_block(self):
        block = build_inline_attachment_block([
            {"name": "notes.md", "content": "# Notes"},
            {"name": "todo.md", "content": "- [ ] task"},
        ])
        self.assertIn('<attached_file name="notes.md">', block)
        self.assertIn("# Notes", block)
        self.assertIn('<attached_file name="todo.md">', block)
        self.assertEqual(block.count("</attached_file>"), 2)

    def test_agora_block_lists_urls(self):
        block = build_agora_attachment_block([
            {"name": "notes.md", "url": "https://example.com/files/notes.md"},
        ])
        self.assertIn("<attached_files>", block)
        self.assertIn("notes.md: https://example.com/files/notes.md", block)
        self.assertIn("resource_fetcher", block)

    def test_agora_block_empty(self):
        self.assertEqual(build_agora_attachment_block([]), "")


class AttachmentFilesTests(unittest.TestCase):
    def test_create_and_cleanup_workspace(self):
        token, tmp_dir, file_urls = create_attachment_files([
            {"name": "notes.md", "content": "# Hello"},
        ])
        try:
            self.assertIsNotNone(token)
            self.assertIsNotNone(tmp_dir)
            self.assertEqual(len(file_urls), 1)
            self.assertEqual(file_urls[0]["name"], "notes.md")
            self.assertIn("notes.md", file_urls[0]["url"])
            self.assertIn(token, file_urls[0]["url"])

            resolved = resolve_eval_file(token, "notes.md")
            self.assertIsNotNone(resolved)
            self.assertEqual(resolved.read_text(encoding="utf-8"), "# Hello")
        finally:
            cleanup_attachment_files(token, tmp_dir)

        self.assertIsNone(resolve_eval_file(token, "notes.md"))

    def test_duplicate_names_get_unique_files(self):
        token, tmp_dir, file_urls = create_attachment_files([
            {"name": "notes.md", "content": "one"},
            {"name": "notes.md", "content": "two"},
        ])
        try:
            self.assertEqual(len(file_urls), 2)
            self.assertNotEqual(file_urls[0]["url"], file_urls[1]["url"])
        finally:
            cleanup_attachment_files(token, tmp_dir)

    def test_no_attachments_no_workspace(self):
        token, tmp_dir, file_urls = create_attachment_files([])
        self.assertIsNone(token)
        self.assertIsNone(tmp_dir)
        self.assertEqual(file_urls, [])


if __name__ == "__main__":
    unittest.main()
