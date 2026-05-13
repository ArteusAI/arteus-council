"""Temporary HTTP-accessible files for Agora evaluation."""

import shutil
import tempfile
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urljoin

from .config import COUNCIL_PUBLIC_BASE_URL

_TMP_PREFIX = "llm-council-agora-eval-"
_registry: dict[str, Path] = {}


def create_eval_workspace() -> tuple[str, Path]:
    """Create and register a temporary evaluation directory."""
    tmp_dir = Path(tempfile.mkdtemp(prefix=_TMP_PREFIX, dir="/tmp")).resolve()
    token = tmp_dir.name.removeprefix(_TMP_PREFIX)
    _registry[token] = tmp_dir
    return token, tmp_dir


def cleanup_eval_workspace(token: str | None, tmp_dir: str | Path | None) -> None:
    """Remove a registered temporary evaluation directory."""
    if token:
        _registry.pop(token, None)
    if tmp_dir:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def build_eval_file_url(token: str, filename: str) -> str:
    """Build the public URL Agora can fetch for an evaluation file."""
    path = f"api/agora-eval-files/{quote(token)}/{quote(filename)}"
    return urljoin(_public_base_url(), path)


def resolve_eval_file(token: str, filename: str) -> Optional[Path]:
    """Resolve a registered evaluation file path, preventing traversal."""
    if (
        not token
        or not filename
        or "/" in token
        or "\\" in token
        or "/" in filename
        or "\\" in filename
    ):
        return None

    tmp_dir = _registry.get(token)
    if tmp_dir is None:
        tmp_dir = (Path("/tmp") / f"{_TMP_PREFIX}{token}").resolve()
        if not tmp_dir.is_dir():
            return None

    candidate = (tmp_dir / filename).resolve()
    try:
        candidate.relative_to(tmp_dir)
    except ValueError:
        return None

    if not candidate.is_file():
        return None
    return candidate


def _public_base_url() -> str:
    base = (COUNCIL_PUBLIC_BASE_URL or "").strip() or "https://api.arteus.us/council/"
    return base if base.endswith("/") else f"{base}/"
