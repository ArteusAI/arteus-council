"""Configuration for the LLM Council."""

import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

# Load environment variables from .env file in the project root
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)


def _parse_csv_env(value: str | None) -> list[str]:
    """Parse a comma-separated env var into a clean list."""
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_float_env(name: str, default: float) -> float:
    """Parse a float env var, falling back to a sane default."""
    value = os.getenv(name)
    if value is None:
        return default

    try:
        return float(value)
    except ValueError:
        print(f"Warning: {name} must be a number, using default {default}")
        return default


def _normalize_root_path(value: str | None) -> str:
    """Normalize a path prefix such as /council for mounting under subpaths."""
    if not value:
        return ""

    candidate = value.strip()
    if not candidate:
        return ""

    if candidate.startswith(("http://", "https://")):
        parsed = urlparse(candidate)
        candidate = parsed.path or ""

    if not candidate:
        return ""

    if not candidate.startswith("/"):
        candidate = f"/{candidate}"

    candidate = candidate.rstrip("/")
    return "" if candidate == "/" else candidate


# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# GigaChat credentials
GIGACHAT_CREDENTIALS = os.getenv("GIGACHAT_CREDENTIALS")
GIGACHAT_SCOPE = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
GIGACHAT_VERIFY_SSL = os.getenv("GIGACHAT_VERIFY_SSL", "False").lower() == "true"
GIGACHAT_PARALLEL_DISABLED = os.getenv("GIGACHAT_PARALLEL_DISABLED", "True").lower() == "true"

# YandexGPT credentials
YANDEX_API_KEY = os.getenv("YANDEX_API_KEY")
YANDEX_FOLDER_ID = os.getenv("YANDEX_FOLDER_ID")

# Arteus Agora RAG credentials
AGORA_API_KEY = os.getenv("AGORA_API_KEY")
AGORA_API_BASE_URL = os.getenv("AGORA_API_BASE_URL", "https://api.arteus-adm.ru/agora/v1").rstrip("/")
AGORA_MODEL_ID = os.getenv("AGORA_MODEL_ID", "agora/rag")
AGORA_POLL_INTERVAL_SECONDS = max(0.0, _parse_float_env("AGORA_POLL_INTERVAL_SECONDS", 1.0))
# Timeout for any single model query (15 minutes)
MODEL_QUERY_TIMEOUT_SECONDS = max(
    1.0,
    _parse_float_env("MODEL_QUERY_TIMEOUT_SECONDS", 900.0),
)
PEER_EVALUATION_TIMEOUT_SECONDS = max(
    1.0,
    _parse_float_env("PEER_EVALUATION_TIMEOUT_SECONDS", 900.0),
)
# Reasoning effort for OpenRouter models ("max", "xhigh", "high", "medium", "low", "minimal", "none")
OPENROUTER_REASONING_EFFORT = os.getenv("OPENROUTER_REASONING_EFFORT", "max")

COUNCIL_PUBLIC_BASE_URL = (
    os.getenv("COUNCIL_PUBLIC_BASE_URL")
    or os.getenv("PUBLIC_BASE_URL")
    or "https://api.arteus.us/council/"
)

# Firecrawl API key for URL scraping
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY")
if not FIRECRAWL_API_KEY:
    print("Warning: FIRECRAWL_API_KEY not found in environment variables")
else:
    print(f"FIRECRAWL_API_KEY loaded: {FIRECRAWL_API_KEY[:4]}...{FIRECRAWL_API_KEY[-4:]}")

# Council members - list of provider model identifiers
COUNCIL_MODELS = [
    "openai/gpt-5.6-sol",
    "google/gemini-3.6-flash",
    "anthropic/claude-fable-5",
    "qwen/qwen3.7-max",
    "x-ai/grok-4.5",
    "moonshotai/kimi-k3",
    "deepseek/deepseek-v4-pro",
    "mistralai/mistral-large-2512",
    "z-ai/glm-5.2",
    "minimax/minimax-m2.7",
    "yandex/aliceai-llm",
    "thinkingmachines/inkling",
    AGORA_MODEL_ID
]

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "openai/gpt-5.6-sol"

# Default preferred models to preselect in the UI
DEFAULT_PREFERRED_MODELS = [
    "openai/gpt-5.6-sol",
    "google/gemini-3.6-flash"
]

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Allowed browser origins for CORS. Set CORS_ALLOW_ORIGINS in .env as a comma-separated list.
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://arteus.us",
    "https://api.arteus.us",
]
CORS_ALLOW_ORIGINS = _parse_csv_env(os.getenv("CORS_ALLOW_ORIGINS")) or DEFAULT_CORS_ORIGINS

# Data directory for conversation storage
DATA_DIR = "data/conversations"

# Soft cap on follow-up turns per conversation (user questions).
MAX_USER_QUESTIONS_PER_CONVERSATION = 3

# Optional path prefix when serving behind a subpath (e.g. /council)
BACKEND_ROOT_PATH = _normalize_root_path(
    os.getenv("BACKEND_ROOT_PATH")
    or os.getenv("COUNCIL_BASE_PATH")
    or os.getenv("BASE_PATH")
    or os.getenv("BASE_URL")
)

# MongoDB configuration
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://142.132.194.113:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "arteus_agora")

# JWT configuration
JWT_SECRET = os.getenv("JWT_SECRET", "secret")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))

# IP-based authentication bypass
ALLOWED_IPS = _parse_csv_env(os.getenv("ALLOWED_IPS", "45.77.54.76"))
ALLOWED_NETWORKS = _parse_csv_env(os.getenv("ALLOWED_NETWORKS", ""))

# Base system prompt to provide company context
BASE_SYSTEM_PROMPT = """We are Arteus — a technology company that creates next-generation intelligent systems for B2B communications and sales. We don't just build chatbots; we construct entire AI assistant platforms that serve as true digital "copilots" for managers. Our mission is to help businesses scale without increasing headcount, accelerate lead processing, improve conversion rates, and outpace competitors through speed and quality.

Our solutions specialize in intelligent speech systems and RAG platforms. They are capable of understanding complex nomenclature, working with massive document arrays, generating precise answers without "hallucinations," automatically preparing commercial proposals, and initiating follow-ups to keep leads warm. This is a comprehensive architecture where knowledge is always up-to-date, and answers are cross-verified by multiple agents to avoid errors. For example, we have Arteus Data Engine for processing any client data, Arteus Learn — our multi-agent training system, and Arteus Communication for full-scale communication based on this knowledge.

Additionally, we have projects like ARES, which handles automated generation, testing, and optimization of advertising video creatives using artificial intelligence. It helps create advertising campaigns that learn and improve themselves, which is crucial in today's algorithmic advertising models. All this allows our clients to increase conversion without risk, process requests instantly, and automate numerous routine operations."""

# Council identity templates (system prompt)
COUNCIL_IDENTITY_TEMPLATES = {
    "arteus": {
        "id": "arteus",
        "name": "Arteus Council",
        "name_ru": "Дружина Артеус",
        "prompt": BASE_SYSTEM_PROMPT,
    },
    "neutral": {
        "id": "neutral",
        "name": "Neutral Assistant",
        "name_ru": "Нейтральный помощник",
        "prompt": "You are a helpful, neutral AI assistant. Your goal is to provide accurate and objective information.",
    },
    "expert": {
        "id": "expert",
        "name": "Expert Consultant",
        "name_ru": "Эксперт-консультант",
        "prompt": "You are a professional consultant with deep expertise in various fields. Provide highly analytical, structured, and evidence-based responses.",
    },
    "medical": {
        "id": "medical",
        "name": "Medical Council",
        "name_ru": "Медицинская дружина",
        "prompt": "You are a council of medical experts. Provide information based on medical science and best practices. Always include a disclaimer that this is not medical advice.",
    },
    "legal": {
        "id": "legal",
        "name": "Legal Council",
        "name_ru": "Юридическая дружина",
        "prompt": "You are a council of legal experts. Provide structured legal analysis and information. Always include a disclaimer that this is not legal advice.",
    },
}
PERSONALIZATION_TEMPLATES = {
    "default": {
        "id": "default",
        "name": "Default",
        "name_ru": "По умолчанию",
        "prompt": "",
    },
    "concise": {
        "id": "concise",
        "name": "Concise & Direct",
        "name_ru": "Кратко и по делу",
        "prompt": "Be concise and direct. Provide short, actionable answers without unnecessary elaboration.",
    },
    "detailed": {
        "id": "detailed",
        "name": "Detailed & Thorough",
        "name_ru": "Подробно и обстоятельно",
        "prompt": "Provide detailed, thorough explanations. Include examples, edge cases, and comprehensive coverage of the topic.",
    },
    "beginner": {
        "id": "beginner",
        "name": "Beginner-Friendly",
        "name_ru": "Для начинающих",
        "prompt": "Explain concepts as if talking to a beginner. Use simple language, avoid jargon, and provide step-by-step guidance.",
    },
    "expert": {
        "id": "expert",
        "name": "Expert Level",
        "name_ru": "Экспертный уровень",
        "prompt": "Assume expert-level knowledge. Skip basic explanations and focus on advanced concepts, optimizations, and best practices.",
    },
    "code_focused": {
        "id": "code_focused",
        "name": "Code-Focused",
        "name_ru": "Код в приоритете",
        "prompt": "Prioritize code examples and practical implementations. Minimize prose explanations in favor of working code.",
    },
    "creative": {
        "id": "creative",
        "name": "Creative & Exploratory",
        "name_ru": "Творческий подход",
        "prompt": "Be creative and think outside the box. Explore unconventional solutions and alternative approaches.",
    },
    "straight": {
        "id": "straight",
        "name": "Straight Talk",
        "name_ru": "Прямой разговор",
        "prompt": "Отвечай чётко и по существу. Никакой воды, вводных фраз и расшаркиваний. Можно неформально — главное конкретика. Если что-то не так — скажи прямо. Никаких расшаркиваний, вводных фраз и политкорректного тумана. Сказал — значит сказал. Ответы должны быть детализированными: раскрывай важные шаги, нюансы, ограничения и практические последствия, но без воды.",
    },
    "tractor": {
        "id": "tractor",
        "name": "Tractor Driver",
        "name_ru": "Тракторист",
        "prompt": "Отвечай по существу, без воды. Используй мат для краткости и придания оттенка - это нормально и уместно. Будь неформальным, жёстким и конкретным. Никаких расшаркиваний и политкорректности.",
    },
    "marketer": {
        "id": "marketer",
        "name": "Expressive Marketer",
        "name_ru": "Экспрессивный маркетолог",
        "prompt": "Будь максимально энергичным, восторженным и убедительным! Используй капс для ключевых слов, много восклицательных знаков и призывов к действию. Твой стиль — это хайп, успех и невероятные возможности! Каждое предложение должно продавать идею или решение.",
    },
}
