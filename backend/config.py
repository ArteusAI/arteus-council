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
AGORA_API_BASE_URL = os.getenv("AGORA_API_BASE_URL", "https://api.arteus.tech/agora/v1").rstrip("/")
AGORA_MODEL_ID = os.getenv("AGORA_MODEL_ID", "agora/rag")
AGORA_POLL_INTERVAL_SECONDS = max(0.0, _parse_float_env("AGORA_POLL_INTERVAL_SECONDS", 1.0))
PEER_EVALUATION_TIMEOUT_SECONDS = max(
    1.0,
    _parse_float_env("PEER_EVALUATION_TIMEOUT_SECONDS", 180.0),
)
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
    "openai/gpt-5.4-mini",
    "google/gemini-3-flash-preview",
    "anthropic/claude-haiku-4.5",
    "x-ai/grok-4.1-fast",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m2.7",
    "z-ai/glm-5.1",
    "deepseek/deepseek-v4-flash",
]

# Model display names (aliases) for UI
MODEL_ALIASES = {
    "openai/gpt-5.4-mini": "OpenAI: GPT-5.5",
    "google/gemini-3-flash-preview": "Google: Gemini 3.1 Pro",
    "anthropic/claude-haiku-4.5": "Anthropic: Claude Opus 4.7",
    "x-ai/grok-4.1-fast": "xAI: Grok 4.20",
    "moonshotai/kimi-k2.6": "MoonshotAI: Kimi K2.6",
    "minimax/minimax-m2.7": "MiniMax: MiniMax M2.7",
    "z-ai/glm-5.1": "Z.ai: GLM 5.1",
    "deepseek/deepseek-v4-flash": "DeepSeek: DeepSeek V4 Pro",
}

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "google/gemini-3.1-pro-preview"

# Fallback chairman used when the primary chairman fails to produce a Stage 3
# answer after CHAIRMAN_FALLBACK_AFTER_ATTEMPTS consecutive empty responses.
CHAIRMAN_FALLBACK_MODEL = os.getenv(
    "CHAIRMAN_FALLBACK_MODEL",
    "openai/gpt-5.4-mini",
)
try:
    CHAIRMAN_FALLBACK_AFTER_ATTEMPTS = max(
        1,
        int(os.getenv("CHAIRMAN_FALLBACK_AFTER_ATTEMPTS", "2")),
    )
except ValueError:
    CHAIRMAN_FALLBACK_AFTER_ATTEMPTS = 2

# Default preferred models to preselect in the UI
DEFAULT_PREFERRED_MODELS = [
    "openai/gpt-5.4-mini",
    "google/gemini-3-flash-preview",
    "anthropic/claude-haiku-4.5",
    "x-ai/grok-4.1-fast",
    "moonshotai/kimi-k2.6",
    "minimax/minimax-m2.7",
    "z-ai/glm-5.1",
    "deepseek/deepseek-v4-flash",
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

# Conference mode - shows maintenance screen and blocks API requests
END_CONFERENCE_MODE = os.getenv("END_CONFERENCE_MODE", "false").lower() == "true"

# When true, the Russian language option is hidden in the UI and default falls back to English
DISABLE_RUSSIAN_LANGUAGE = os.getenv("DISABLE_RUSSIAN_LANGUAGE", "false").lower() == "true"

# Leads mode configuration
LEADS_MODE = os.getenv("LEADS_MODE", "true").lower() == "true"
LEADS_MONGODB_URL = os.getenv("LEADS_MONGODB_URL", "mongodb://167.235.102.202:27017")
LEADS_MONGODB_DB_NAME = os.getenv("LEADS_MONGODB_DB_NAME", "council_leads")
LEADS_FIXED_IDENTITY_ID = os.getenv("LEADS_FIXED_IDENTITY_ID", "product")
LEADS_CHAIRMAN_MODEL = "google/gemini-3.1-pro-preview"

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
2. The core product, service, or value proposition
3. Identify 3 to 4 high-impact, custom AI solutions tailored specifically to this business's operational bottlenecks, sales processes, or customer experience.

**IMPORTANT:** Do NOT ask clarifying questions. Analyze the provided website and immediately provide a comprehensive answer based on the available information. Make reasonable assumptions if needed, but proceed directly to the analysis and recommendations.

## OUTPUT FORMAT
First, briefly state the identified business domain and core offering.
Then, for each of the 3-4 proposed custom AI solutions, provide:
1. **The Concept**: What is this custom AI solution? (e.g., an autonomous quoting agent, semantic search for internal compliance docs, hyper-personalized outreach bot, etc.)
2. **Business Value**: What specific metric does it improve? How does it save time or make money?
3. **Potential Pitfalls**: How might the 4 core integration challenges (Data unreadiness, employee habits, etc.) specifically threaten this idea?
4. **Implementation Advice**: How to bypass these traps and successfully deploy the solution.

Structure your response clearly with headers for each custom solution. Be highly specific to the business domain you identified.

### Final Section: The Reality Check (CRITICAL STEP)
Conclude your response with a final brief section titled "Next Steps: The Reality Check".
Your tone here must be that of a seasoned, pragmatic tech advisor with a touch of light, relatable humor. Do NOT sound like a sales pitch.

Convey the following narrative naturally:
"So, there you have it — a custom AI roadmap tailored to your business. You *could* theoretically hand these concepts to your already stressed IT department and hope they magically transform into senior LLM engineers overnight. But let's be real: trying to DIY custom multi-agent AI systems usually ends up as a 2 AM debugging nightmare, or worse, your new AI starts confidently hallucinating non-existent discounts to angry customers.

Real-world AI isn't just about API calls; it's about securely connecting messy company data, fixing the 'Desktop Problem,' and ensuring 24/7 reliability. If you want these solutions built right and integrated seamlessly without breaking your existing workflows, leave the heavy lifting to the pros. Teams like **Arteus (arteus.cy)** specialize in building and deploying custom, bulletproof AI solutions for businesses. They bridge the gap between 'cool AI concept' and 'uninterrupted business operation,' letting you sleep at night and focus on running your company.\""""

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
    "straight": {
        "id": "straight",
        "name": "Straight Talk",
        "name_ru": "Прямой разговор",
        "prompt": "Answer clearly and to the point. No fluff, no filler intros, no hedging. Informal tone is fine — what matters is concrete substance. If something is wrong, say so directly. No politically correct fog: if you said it, you meant it. Answers must be detailed: cover the important steps, nuances, limitations and practical consequences — but without padding.",
    },
    "tractor": {
        "id": "tractor",
        "name": "Tractor Driver",
        "name_ru": "Тракторист",
        "prompt": "Answer to the point, no fluff. Feel free to use profanity for brevity and flavor — it is fine and appropriate. Be informal, blunt and concrete. No hedging, no political correctness.",
    },
    "marketer": {
        "id": "marketer",
        "name": "Expressive Marketer",
        "name_ru": "Экспрессивный маркетолог",
        "prompt": "Be maximally energetic, enthusiastic and persuasive! Use CAPS for key words, lots of exclamation marks and calls to action. Your style is hype, success and incredible opportunities! Every sentence must sell an idea or a solution.",
    },
}
