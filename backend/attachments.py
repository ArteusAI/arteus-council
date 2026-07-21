"""File attachment support: validation, token estimation, prompt blocks, Agora hosting."""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .agora_eval_files import (
    build_eval_file_url,
    cleanup_eval_workspace,
    create_eval_workspace,
)

logger = logging.getLogger("llm-council.attachments")

# Total token budget for all attachments in a single message
MAX_ATTACHMENT_TOKENS = 200_000

ALLOWED_EXTENSION = ".md"


def estimate_tokens(text: str) -> int:
    """
    Fast token estimate based on character classes.

    Mirrors ai/lib/token_estimator.py from arteus-assistant-agora:
    ASCII-heavy text is close to 0.25 tokens per char,
    non-ASCII-heavy text is closer to 0.45 tokens per char.
    """
    if not text:
        return 0

    ascii_count = sum(ord(char) < 128 for char in text)
    non_ascii_count = len(text) - ascii_count
    return max(1, int(ascii_count * 0.25 + non_ascii_count * 0.45))


def estimate_attachments_tokens(attachments: List[Dict[str, Any]]) -> int:
    """Estimate the total token count across all attachments."""
    return sum(estimate_tokens(str(item.get("content") or "")) for item in attachments)


def _format_thousands(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def validate_attachments(attachments: List[Dict[str, Any]]) -> None:
    """
    Validate attachments: .md only, total tokens within budget.

    Raises:
        ValueError: with a plain-spoken explanation if validation fails.
    """
    for item in attachments:
        name = str(item.get("name") or "")
        if not name.lower().endswith(ALLOWED_EXTENSION):
            raise ValueError(
                f"Только .md файлы. «{name}» — не markdown. "
                "Пересохрани как .md и приходи."
            )

    total_tokens = estimate_attachments_tokens(attachments)
    if total_tokens > MAX_ATTACHMENT_TOKENS:
        raise ValueError(
            "Не жируй. Вложения — максимум "
            f"~{_format_thousands(MAX_ATTACHMENT_TOKENS)} токенов суммарно, "
            f"у тебя вышло ~{_format_thousands(total_tokens)}. "
            "Топ-модели работают на max thinking effort — каждый токен "
            "дорого обдумывается. Урежь файлы и приходи заново."
        )


def normalize_attachments(attachments: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Return clean [{name, content}] dicts with empty files removed."""
    normalized = []
    for item in attachments:
        name = str(item.get("name") or "").strip()
        content = str(item.get("content") or "")
        if not name or not content.strip():
            continue
        normalized.append({"name": name, "content": content})
    return normalized


def build_inline_attachment_block(attachments: List[Dict[str, str]]) -> str:
    """Build inline <attached_file> blocks for standard (non-Agora) models."""
    chunks = []
    for item in attachments:
        chunks.append(
            f'\n\n<attached_file name="{item["name"]}">\n'
            f'{item["content"]}\n'
            "</attached_file>"
        )
    return "".join(chunks)


def build_agora_attachment_block(file_urls: List[Dict[str, str]]) -> str:
    """
    Build the Agora attachment section: URLs that Agora's resource_fetcher
    prefetches into its attachment context.
    """
    if not file_urls:
        return ""

    file_list = "\n".join(
        f"- {item['name']}: {item['url']}" for item in file_urls
    )
    return f"""

<attached_files>
The user attached the following files to this message. They are included as URLs so your RAG prefetch layer can fetch them and inject their contents into the context before you answer:

{file_list}

Use the fetched resource context for these files as the source of the attached file contents. It may appear in blocks such as <resource_fetcher_results>, <resource_fetcher_result ...>, <resource_fetcher_summary>, <resource_fetcher_sources>, or <resource ...>. Treat the fetched contents as user-attached files and use them when answering. Do not try to call a tool yourself.
</attached_files>"""


def create_attachment_files(
    attachments: List[Dict[str, str]],
) -> Tuple[Optional[str], Optional[str], List[Dict[str, str]]]:
    """
    Write attachments to a temporary HTTP-accessible workspace for Agora.

    Returns:
        Tuple of (token, tmp_dir, [{name, url}]). token/tmp_dir are None
        when there is nothing to host.
    """
    if not attachments:
        return None, None, []

    token, tmp_path = create_eval_workspace()
    tmp_dir = str(tmp_path)
    file_urls: List[Dict[str, str]] = []

    used_names = set()
    for index, item in enumerate(attachments, start=1):
        filename = Path(item["name"]).name or f"attachment_{index}.md"
        if not filename.lower().endswith(ALLOWED_EXTENSION):
            filename = f"{filename}{ALLOWED_EXTENSION}"
        if filename in used_names:
            filename = f"{Path(filename).stem}_{index}{ALLOWED_EXTENSION}"
        used_names.add(filename)

        file_path = tmp_path / filename
        file_path.write_text(item["content"], encoding="utf-8")
        file_url = build_eval_file_url(token, filename)
        file_urls.append({"name": item["name"], "url": file_url})
        logger.info(
            "Attachment file created: name=%r filename=%s bytes=%s url=%s",
            item["name"],
            filename,
            file_path.stat().st_size,
            file_url,
        )

    return token, tmp_dir, file_urls


def cleanup_attachment_files(token: Optional[str], tmp_dir: Optional[str]) -> None:
    """Remove temporary attachment files best-effort."""
    cleanup_eval_workspace(token, tmp_dir)
