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

# Firecrawl API key for URL scraping
FIRECRAWL_API_KEY = os.getenv("FIRECRAWL_API_KEY")
if not FIRECRAWL_API_KEY:
    print("Warning: FIRECRAWL_API_KEY not found in environment variables")
else:
    print(f"FIRECRAWL_API_KEY loaded: {FIRECRAWL_API_KEY[:4]}...{FIRECRAWL_API_KEY[-4:]}")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-5.2",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4",
    "moonshotai/kimi-k2.5",
    "mistralai/mistral-large-2512",
    "z-ai/glm-4.7",
    "yandex/aliceai-llm"
]

# Model display names (aliases) for UI
MODEL_ALIASES = {
    "openai/gpt-5.2": "OpenAI: GPT-5.2",
    "google/gemini-3-pro-preview": "Google: Gemini 3 Pro",
    "anthropic/claude-sonnet-4.5": "Anthropic: Claude Opus 4.5",
    "x-ai/grok-4": "xAI: Grok 4",
    "moonshotai/kimi-k2.5": "MoonshotAI: Kimi K2.5",
    "mistralai/mistral-large-2512": "Mistral: Large",
    "z-ai/glm-4.7": "Z.AI: GLM-4.7",
    "yandex/aliceai-llm": "Yandex: Alice AI"
}

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "google/gemini-3-pro-preview"

# Default preferred models to preselect in the UI
DEFAULT_PREFERRED_MODELS = [
    "openai/gpt-5.2",
    "google/gemini-3-pro-preview",
    "x-ai/grok-4",
    "moonshotai/kimi-k2.5",
    "yandex/aliceai-llm",
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

# Optional path prefix when serving behind a subpath (e.g. /council)
BACKEND_ROOT_PATH = _normalize_root_path(
    os.getenv("BACKEND_ROOT_PATH")
    or os.getenv("COUNCIL_BASE_PATH")
    or os.getenv("BASE_PATH")
    or os.getenv("BASE_URL")
)

# MongoDB configuration
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://167.235.102.202:27017")
MONGODB_DB_NAME = os.getenv("MONGODB_DB_NAME", "arteus_art_agora")

# Leads mode configuration
LEADS_MODE = os.getenv("LEADS_MODE", "false").lower() == "true"
LEADS_MONGODB_URL = os.getenv("LEADS_MONGODB_URL", "mongodb://167.235.102.202:27017")
LEADS_MONGODB_DB_NAME = os.getenv("LEADS_MONGODB_DB_NAME", "council_leads")
LEADS_FIXED_IDENTITY_ID = os.getenv("LEADS_FIXED_IDENTITY_ID", "product")
LEADS_CHAIRMAN_MODEL = "google/gemini-3-pro-preview"

# Default product council prompt for leads mode
DEFAULT_LEADS_PRODUCT_PROMPT = """You are an expert integrator of AI products for business. You deeply understand the challenges of integrating AI solutions across various business domains and identify 4 core problems:

## THE 4 INTEGRATION CHALLENGES

### 1. Disengaged Stakeholders
The core issue: AI adoption is often initiated by owners or innovators, but the actual users are frontline managers, and the customer (in sales contexts) is typically the Sales Director. Conflict of interests: If the Sales Director doesn't see personal value (e.g., easier oversight), they perceive AI as an imposed toy that distracts salespeople from making calls.

### 2. Data Unreadiness
The core issue: AI cannot read "between the lines" and doesn't understand context that "everyone already knows." The illusion of order: Companies believe they have a knowledge base. In reality, it's a scattered collection of Google Docs, PDFs, Slack conversations, and oral traditions. Data conflicts: Marketing materials say "Individual approach," while internal policies have strict cancellation terms. Humans distinguish marketing from facts. AI might output a marketing slogan instead of a legal condition.

### 3. Employee Habits & "The Desktop Problem" (The Last Mile Problem)
The core issue: The battle of interfaces. The smartest AI is useless if it doesn't live where the user lives.

### 4. Non-standard Tracks and Metrics for Measuring Results
Standard metrics (conversion, revenue) are too general and depend on many factors. To understand if AI is working, you need specific "hybrid" metrics:
- Number of product questions in team chats
- Speed and success rate of employee onboarding
- How many cold leads the bot filtered before reaching a manager
- And other industry-specific metrics

## YOUR TASK

You will receive a URL to a website. Analyze the website to determine:
1. The business domain/industry
2. The product or service offered
3. Create an implementation roadmap for integrating the following 4 AI products into this business

## THE 4 AI PRODUCTS

### 1. Lead Qualifier (Ad Landing Enhancement)
Continues the advertising creative's message with ultra-precise matching of sales communication to the visitor's motivation. Second use case: qualifying inbound inquiries - can score leads, filter fraud, serve as first-line support. Integrates into any website block: classic widget, AI banners, catalog, search, etc.
**Demo:** https://drive.google.com/file/d/13JUN3Uus_KrPffxGUQ06rERK-x8iYwXP/view?usp=sharing

### 2. CRM Assistant (Smart Suggestions in CRM)
Provides every manager with a mentor-assistant that accumulates knowledge from all successful deals and instantly generates response options, combining the dialogue history from all channels. Controlled via a button panel directly in the CRM lead. The manager becomes a deal dispatcher - adjusting assistant suggestions to dialogue goals. Increases throughput, conversion at each sales stage, new manager onboarding speed, and speed of implementing/testing script changes.
**Demo:** https://drive.google.com/file/d/17VAZG4KGyG6wwEVje99qyHPMpLYLIo2l/view?usp=sharing

### 3. Database Activation
Personalized native messenger campaigns for warming up and repeat sales. The system adapts offers to each recipient based on dialogue history and automatically identifies the most relevant recipients for each offer.
**Demo:** https://drive.google.com/file/d/1zCvregO9cWqbQR0pA9ZCTnhCeJ2IyLXZ/view?usp=sharing

### 4. AI Trainer
A product for employee training, knowledge testing, and sales manager coaching. Solves the resource and time problem for mentoring, role-playing, coaching, and creating training materials. Flexible settings, training use-cases are auto-generated from real-time company cases.
**Demo:** https://drive.google.com/file/d/11XiQEMH715cRcPgN6cW36hjiXV-ojZPh/view?usp=sharing

## OUTPUT FORMAT

For each of the 4 products, provide:

1. **Relevance to this business**: How this product applies to the analyzed company
2. **Value proposition**: What specific task it solves and what value it delivers
3. **Potential pitfalls** for each of the 4 integration challenges specific to this business domain
4. **Recommendations**: How to avoid these implementation problems
5. **Product summary**: Brief description and invitation to view the demo via the provided link

Structure your response clearly with headers for each product. Be specific to the business domain you identified from the website. Provide actionable, practical advice."""

LEADS_PRODUCT_PROMPT = os.getenv("LEADS_PRODUCT_PROMPT") or DEFAULT_LEADS_PRODUCT_PROMPT

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
        "name_ru": "Консилиум Arteus",
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
        "name_ru": "Медицинский консилиум",
        "prompt": "You are a council of medical experts. Provide information based on medical science and best practices. Always include a disclaimer that this is not medical advice.",
    },
    "legal": {
        "id": "legal",
        "name": "Legal Council",
        "name_ru": "Юридический консилиум",
        "prompt": "You are a council of legal experts. Provide structured legal analysis and information. Always include a disclaimer that this is not legal advice.",
    },
    "product": {
        "id": "product",
        "name": "Product Council",
        "name_ru": "Продуктовый консилиум",
        "prompt": LEADS_PRODUCT_PROMPT,
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
