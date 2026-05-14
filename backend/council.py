"""3-stage LLM Council orchestration."""

import asyncio
import logging
import math
import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .agora_eval_files import (
    build_eval_file_url,
    cleanup_eval_workspace,
    create_eval_workspace,
)
from .config import (
    BASE_SYSTEM_PROMPT,
    CHAIRMAN_MODEL,
    COUNCIL_MODELS,
    LEADS_CHAIRMAN_MODEL,
    LEADS_MODE,
    PEER_EVALUATION_TIMEOUT_SECONDS,
    PERSONALIZATION_TEMPLATES,
)
from .llm import query_model, query_models_parallel

logger = logging.getLogger("llm-council.council")

FINAL_SYNTHESIS_MAX_ATTEMPTS = 3
PEER_EVALUATION_MAX_ATTEMPTS = 3


LANGUAGE_NAMES = {
    "en": "English",
    "ru": "Russian",
    "el": "Greek",
}


def language_instruction(language: str | None) -> str:
    """Return a plain sentence telling the model which language to use."""
    if not language:
        return ""
    name = LANGUAGE_NAMES.get(language.lower(), "the user's language")
    return f" Please write your answer in {name}."


def is_agora_model(model: str) -> bool:
    """Return whether a model should use the Agora-specific request path."""
    return model.startswith("agora/")


def get_peer_ranking_models(models: List[str] | None = None) -> List[str]:
    """Return models that should participate in stage-2 peer ranking."""
    return list(models or COUNCIL_MODELS)


def build_personalization_section(personal_prompt: str | None) -> str:
    """Build the personalization section for the prompt."""
    if not personal_prompt:
        return ""
    return (
        "\n\nIMPORTANT STYLE INSTRUCTIONS:\n"
        "You MUST strictly follow these instructions for the tone and style "
        f"of your final response:\n{personal_prompt}\n"
    )


def build_stage1_prompt(
    user_query: str,
    language: str | None = None,
    base_system_prompt: str | None = None,
) -> str:
    """Build the prompt used for the initial response round."""
    detailed_instruction = (
        "\n\nPlease provide a comprehensive, detailed answer covering all "
        "nuances and aspects of the question."
    )
    if language:
        language_note = language_instruction(language)
    else:
        language_note = (
            "\n\nLANGUAGE SELECTION:\n"
            "- Respond in the same language as the user's question.\n"
            "- If the question is just a URL or too short to detect the language, "
            "respond in the predominant language of the provided website/page content.\n"
            "- If the website content language cannot be determined, fall back to "
            "Russian for .ru domains and English otherwise."
        )
    if base_system_prompt:
        return (
            f"CONTEXT:\n{base_system_prompt}\n\nQUESTION: {user_query}"
            f"{detailed_instruction}{language_note}"
        )
    return f"{user_query}{detailed_instruction}{language_note}"


def build_label_to_model(stage1_results: List[Dict[str, Any]]) -> Dict[str, str]:
    """Map anonymized response labels to model names."""
    labels = [chr(65 + i) for i in range(len(stage1_results))]
    return {
        f"Response {label}": result["model"]
        for label, result in zip(labels, stage1_results)
    }


def build_model_to_label(label_to_model: Dict[str, str]) -> Dict[str, str]:
    """Return the inverse map of build_label_to_model()."""
    return {model: label for label, model in label_to_model.items()}


def _result_response_text(result: Dict[str, Any]) -> str:
    """Extract a non-empty response text from known result shapes."""
    for key in ("response", "content", "answer", "text"):
        value = result.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def format_anonymized_responses(
    stage1_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> str:
    """Format responses using anonymous labels."""
    model_to_label = build_model_to_label(label_to_model)
    chunks = []
    for result in stage1_results:
        label = model_to_label.get(result["model"], result["model"])
        chunks.append(f"{label}:\n{_result_response_text(result)}")
    return "\n\n".join(chunks)


def format_anonymized_rag_contexts(
    stage1_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> str:
    """Format RAG context using anonymous response labels."""
    model_to_label = build_model_to_label(label_to_model)
    chunks = []
    for result in stage1_results:
        rag_context = str(result.get("rag_context") or "").strip()
        if not rag_context:
            continue
        label = model_to_label.get(result["model"], result["model"])
        chunks.append(f"{label} RAG context:\n{rag_context}")
    return "\n\n".join(chunks)


def format_anonymized_evaluations(stage2_results: List[Dict[str, Any]]) -> str:
    """Format peer evaluations without exposing evaluator identities."""
    if not stage2_results:
        return "No peer evaluations were available."
    chunks = []
    for index, result in enumerate(stage2_results, start=1):
        chunks.append(f"Reviewer {index}:\n{result['ranking']}")
    return "\n\n".join(chunks)


def format_anonymized_aggregate_rankings(
    aggregate_rankings: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> str:
    """Format aggregate rankings using anonymous response labels."""
    if not aggregate_rankings:
        return "No aggregate ranking was available."

    model_to_label = build_model_to_label(label_to_model)
    lines = []
    for index, item in enumerate(aggregate_rankings, start=1):
        label = model_to_label.get(item["model"], item["model"])
        avg = item["average_rank"]
        votes = item["rankings_count"]
        lines.append(f"{index}. {label} (average rank: {avg}, votes: {votes})")
    return "\n".join(lines)


def build_ranking_prompt(
    user_query: str,
    responses_text: str,
    language: str | None = None,
    rag_contexts_text: str | None = None,
) -> str:
    """Build the peer-ranking prompt shared by stage 2 rounds."""
    language_note = language_instruction(language)
    rag_context_block = ""
    if rag_contexts_text:
        rag_context_block = f"""
<rag_evidence_context>
<title>RAG EVIDENCE CONTEXT:</title>
<instructions>
The following context was retrieved by RAG-backed responses. Use it as evidence when checking factual accuracy, completeness, and groundedness. Do not rank a response higher only because RAG context exists; rank based on how well the answer uses available evidence and answers the question.
</instructions>
<context_data>

{rag_contexts_text}

</context_data>
</rag_evidence_context>

"""
    return f"""You are evaluating different responses to the following question.
Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

{rag_context_block}\
Evaluation criteria:
- Correctness and directness: prefer answers that address the user's question accurately and completely.
- Context alignment: if RAG evidence context is available, use it to judge factual accuracy, completeness, and groundedness. Reward responses that use the available context accurately and cover important context; penalize contradictions, unsupported claims, or missing important evidence. If no context is available, do not penalize a response for lacking context references.
- Detail and usefulness: prefer rich, well-structured answers with relevant details, examples, caveats, practical implications, and domain context.
- Brevity is not a quality signal by itself. Do not rank a response higher just because it is shorter. Rank overly terse answers lower when they omit useful detail or context. Penalize length only when it adds repetition, filler, off-topic material, or makes the answer harder to use.

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.
3. Write your explanations{language_note or ' in English.'} Keep the FINAL RANKING block exactly as specified in English.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""


def _label_suffix(label: str) -> str:
    return label.replace("Response ", "").strip().upper()


def create_agora_evaluation_files(
    stage1_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> Tuple[str, str, Dict[str, str]]:
    """Write anonymized participant responses and return public fetch URLs."""
    token, tmp_path = create_eval_workspace()
    tmp_dir = str(tmp_path)
    model_to_label = build_model_to_label(label_to_model)
    file_urls: Dict[str, str] = {}

    for result in stage1_results:
        label = model_to_label.get(result["model"], result["model"])
        filename = f"response_{_label_suffix(label)}.md"
        file_path = Path(tmp_dir) / filename
        answer_text = _result_response_text(result)
        if not answer_text:
            raise ValueError(f"Agora evaluation file would be empty for {label}")
        content_parts = [
            f"# {label}",
            "## Answer",
            answer_text,
        ]
        rag_context = str(result.get("rag_context") or "").strip()
        if rag_context:
            content_parts.extend(["## RAG context", rag_context])
        file_path.write_text("\n\n".join(content_parts).strip() + "\n", encoding="utf-8")
        file_url = build_eval_file_url(token, filename)
        file_urls[label] = file_url
        logger.info(
            "Agora evaluation file created: label=%s filename=%s answer_len=%s rag_context_len=%s bytes=%s url=%s",
            label,
            filename,
            len(answer_text),
            len(rag_context),
            file_path.stat().st_size,
            file_url,
        )

    return token, tmp_dir, file_urls


def find_empty_response_labels(
    stage1_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> List[str]:
    """Return anonymous labels whose response text is empty."""
    model_to_label = build_model_to_label(label_to_model)
    return [
        model_to_label.get(result["model"], result["model"])
        for result in stage1_results
        if not _result_response_text(result)
    ]


def cleanup_agora_evaluation_files(token: str | None, tmp_dir: str | None) -> None:
    """Remove temporary Agora evaluation files best-effort."""
    cleanup_eval_workspace(token, tmp_dir)


def build_agora_file_ranking_prompt(
    user_query: str,
    label_to_file_url: Dict[str, str],
    language: str | None = None,
) -> str:
    """Build an Agora ranking prompt that references response file URLs."""
    language_note = language_instruction(language)
    file_list = "\n".join(
        f"- {label}: {url}"
        for label, url in label_to_file_url.items()
    )

    return f"""You are evaluating different responses to the following question.
Question: {user_query}

The participant responses are available at the URLs below. They are included so Agora's RAG prefetch layer can fetch them and inject their contents into the context before you answer:

{file_list}

Use the fetched resource context for these files as the source of answer text. It may appear in blocks such as <resource_fetcher_results>, <resource_fetcher_result ...>, <resource_fetcher_summary>, <resource_fetcher_sources>, or <resource ...>. Match response labels by the file list above, filenames such as response_A.md, and labels inside fetched file bodies such as "# Response A". Do not try to call a tool yourself.

Important resource handling rules:
- If <resource_fetcher_result> blocks are present, treat their contents as the actual fetched response files and evaluate them.
- A response label can appear inside the fetched file body, for example "# Response A", even if the fetched source filename is random.
- Do not return an unavailable message when fetched blocks contain "# Response ..." and "## Answer" sections.
- Return exactly "AGORA EVALUATION UNAVAILABLE: missing fetched response resources" only if no fetched block or summary contains any response answer text.

Evaluation criteria:
- Correctness and directness: prefer answers that address the user's question accurately and completely.
- Context alignment: when fetched resources or ## RAG context sections are present, use them to judge factual accuracy, completeness, and groundedness. Reward responses that use the available context accurately and cover important context; penalize contradictions, unsupported claims, or missing important evidence. If no context is available, do not penalize a response for lacking context references.
- Detail and usefulness: prefer rich, well-structured answers with relevant details, examples, caveats, practical implications, and domain context.
- Brevity is not a quality signal by itself. Do not rank a response higher just because it is shorter. Rank overly terse answers lower when they omit useful detail or context. Penalize length only when it adds repetition, filler, off-topic material, or makes the answer harder to use.

Your task:
1. Evaluate every response individually using the fetched file contents and any RAG context inside those files.
2. Assign each response a score from 1 to 10.
3. Assign each response a unique rank, where rank 1 is best.
4. Write focused notes{language_note or ' in English.'}
5. Do not return JSON. Return only the simple text format below.

Required output format:
AGORA EVALUATION:
Response A | score: 9 | rank: 1 | note: focused reason
Response B | score: 6 | rank: 2 | note: focused reason

FINAL RANKING:
1. Response A
2. Response B

Keep response labels exactly as shown. Do not mention model names."""


def build_round_metadata(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> Dict[str, Any]:
    """Build metadata for a response/evaluation round."""
    return {
        "label_to_model": label_to_model,
        "aggregate_rankings": calculate_aggregate_rankings(stage2_results, label_to_model),
    }


def build_round_payload(
    round_number: int,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Build the structured payload for one deliberation round."""
    return {
        "round": round_number,
        "stage1": stage1_results,
        "stage2": stage2_results,
        "metadata": metadata,
    }


def select_second_round_finalists(
    stage1_results: List[Dict[str, Any]],
    aggregate_rankings: List[Dict[str, Any]],
) -> List[str]:
    """Pick finalists for the second round from stage-1 responders."""
    stage1_models = [result["model"] for result in stage1_results]
    if len(stage1_models) <= 4:
        return stage1_models

    ranked_models = [
        item["model"]
        for item in aggregate_rankings
        if item["model"] in stage1_models
    ]
    for model in stage1_models:
        if model not in ranked_models:
            ranked_models.append(model)

    finalist_count = math.ceil(len(stage1_models) / 2)
    finalist_count = max(3, finalist_count)
    finalist_count = min(5, finalist_count, len(stage1_models))
    return ranked_models[:finalist_count]


def calculate_second_round_status(
    finalists: List[str],
    revised_results: List[Dict[str, Any]],
    round2_rankings: List[Dict[str, Any]],
) -> str:
    """Describe whether the second round completed cleanly or partially."""
    if not finalists:
        return "skipped"
    if not revised_results:
        return "failed"

    revised_models = [item["model"] for item in revised_results]
    if len(revised_models) < len(finalists):
        return "partial"

    if len(revised_models) < 2:
        return "partial"

    if len(round2_rankings) < len(revised_models):
        return "partial"

    return "completed"


def is_valid_peer_evaluation_response(
    model: str,
    response: Optional[Dict[str, Any]],
    expected_labels: List[str],
) -> bool:
    """Return whether a peer evaluator produced a complete parseable ranking."""
    if response is None:
        return False

    full_text = str(response.get("content") or "").strip()
    if not full_text:
        return False

    if is_agora_model(model):
        return is_valid_agora_evaluation(full_text, expected_labels)

    if "FINAL RANKING:" not in full_text:
        return False

    parsed = parse_ranking_from_text(full_text)
    expected = set(expected_labels)
    return len(parsed) == len(expected_labels) and set(parsed) == expected


async def query_model_messages_parallel(
    model_messages: Dict[str, List[Dict[str, str]]],
    on_model_complete: Optional[Any] = None,
    timeout: float = 300.0,
    validate_response: Optional[Callable[[str, Optional[Dict[str, Any]]], bool]] = None,
    max_attempts: int = 1,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """Query different models in parallel with model-specific messages."""

    async def _query_and_callback(model: str, messages: List[Dict[str, str]]):
        attempts = max(1, max_attempts)
        response = None
        for attempt in range(1, attempts + 1):
            response = await query_model(model, messages, timeout=timeout)
            if validate_response is None:
                is_valid = response is not None
            else:
                try:
                    is_valid = validate_response(model, response)
                except Exception as exc:
                    logger.exception("[%s] Response validator failed: %s", model, exc)
                    is_valid = False

            if is_valid:
                break

            if attempt < attempts:
                logger.warning(
                    "[%s] Invalid or empty model response on attempt %s/%s; retrying",
                    model,
                    attempt,
                    attempts,
                )
            else:
                logger.error(
                    "[%s] Invalid or empty model response after %s attempts",
                    model,
                    attempts,
                )

        if on_model_complete:
            if asyncio.iscoroutinefunction(on_model_complete):
                await on_model_complete(model, response)
            else:
                on_model_complete(model, response)
        return model, response

    tasks = [
        _query_and_callback(model, messages)
        for model, messages in model_messages.items()
    ]
    results = await asyncio.gather(*tasks)
    return {model: response for model, response in results}


def build_revision_prompt(
    model: str,
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
    aggregate_rankings: List[Dict[str, Any]],
    language: str | None = None,
    base_system_prompt: str | None = None,
) -> str:
    """Build the per-model prompt for the second-round rewrite."""
    own_response = next(
        (result["response"] for result in stage1_results if result["model"] == model),
        "",
    )
    context_block = ""
    if base_system_prompt:
        context_block = f"CONTEXT:\n{base_system_prompt}\n\n"

    return f"""You are revising your earlier answer after an anonymous peer-review round.
{context_block}Original question: {user_query}

Your previous answer:
{own_response}

All round-1 responses (anonymized):
{format_anonymized_responses(stage1_results, label_to_model)}

Peer evaluations from round 1 (reviewers remain anonymous):
{format_anonymized_evaluations(stage2_results)}

Aggregate ranking from round 1 (anonymous labels only):
{format_anonymized_aggregate_rankings(aggregate_rankings, label_to_model)}

Your task:
1. Improve your answer using the peer feedback.
2. Fix weaknesses, mistakes, omissions, and poor structure.
3. Borrow strong ideas from the better anonymous responses where helpful.
4. Do NOT mention rankings, reviews, or that this is a revision.
5. Output only the revised answer, with no preamble.

Return a stronger final answer to the original question.{language_instruction(language)}"""


async def stage1_collect_responses(
    user_query: str,
    models: List[str] | None = None,
    language: str | None = None,
    base_system_prompt: str | None = None,
    on_model_complete: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question
        models: Optional override list of models to query
        language: Optional language preference
        base_system_prompt: Optional override for company context
        on_model_complete: Optional callback when a model completes

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    prompt = build_stage1_prompt(
        user_query,
        language=language,
        base_system_prompt=base_system_prompt,
    )
    messages = [{"role": "user", "content": prompt}]
    models_to_use = models or COUNCIL_MODELS

    responses = await query_models_parallel(
        models_to_use,
        messages,
        on_model_complete=on_model_complete,
    )

    stage1_results = []
    for model, response in responses.items():
        if response is not None:
            content = str(response.get("content") or "").strip()
            if not content:
                logger.warning("[%s] Empty stage 1 response; skipping participant", model)
                continue
            result = {
                "model": model,
                "response": content,
            }
            rag_context = response.get("rag_context")
            if rag_context:
                result["rag_context"] = rag_context
            stage1_results.append(result)

    return stage1_results


async def stage1_collect_revised_responses(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    finalist_models: List[str],
    aggregate_rankings: List[Dict[str, Any]],
    language: str | None = None,
    base_system_prompt: str | None = None,
    on_model_complete: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """Collect second-round revised responses from the finalist models."""
    label_to_model = build_label_to_model(stage1_results)
    model_messages: Dict[str, List[Dict[str, str]]] = {}

    for model in finalist_models:
        if model not in {result["model"] for result in stage1_results}:
            continue
        prompt = build_revision_prompt(
            model,
            user_query,
            stage1_results,
            stage2_results,
            label_to_model,
            aggregate_rankings,
            language=language,
            base_system_prompt=base_system_prompt,
        )
        model_messages[model] = [{"role": "user", "content": prompt}]

    responses = await query_model_messages_parallel(
        model_messages,
        on_model_complete=on_model_complete,
    )

    revised_results = []
    for model in finalist_models:
        response = responses.get(model)
        if response is not None:
            content = str(response.get("content") or "").strip()
            if not content:
                logger.warning("[%s] Empty round 2 revision; skipping participant", model)
                continue
            result = {
                "model": model,
                "response": content,
            }
            rag_context = response.get("rag_context")
            if rag_context:
                result["rag_context"] = rag_context
            revised_results.append(result)
    return revised_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    models: List[str] | None = None,
    language: str | None = None,
    base_system_prompt: str | None = None,
    on_model_complete: Optional[Any] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1
        models: Optional override list of models to use for rankings
        base_system_prompt: Optional override for company context
        on_model_complete: Optional callback when a model completes

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    models_to_use = get_peer_ranking_models(models)
    label_to_model = build_label_to_model(stage1_results)
    if not models_to_use:
        logger.info("No peer-ranking models available; skipping stage 2 ranking")
        return [], label_to_model

    responses_text = format_anonymized_responses(stage1_results, label_to_model)
    rag_contexts_text = format_anonymized_rag_contexts(stage1_results, label_to_model)
    standard_ranking_prompt = build_ranking_prompt(
        user_query,
        responses_text,
        rag_contexts_text=rag_contexts_text,
        language=language,
    )

    model_messages: Dict[str, List[Dict[str, str]]] = {}
    standard_messages = [{"role": "user", "content": standard_ranking_prompt}]
    for model in models_to_use:
        if not is_agora_model(model):
            model_messages[model] = standard_messages

    agora_token = None
    agora_tmp_dir = None
    agora_models = [model for model in models_to_use if is_agora_model(model)]
    if agora_models:
        empty_labels = find_empty_response_labels(stage1_results, label_to_model)
        if empty_labels:
            logger.error(
                "Skipping Agora peer evaluation because response text is empty for labels: %s",
                empty_labels,
            )
            agora_models = []

    if agora_models:
        agora_token, agora_tmp_dir, agora_file_urls = create_agora_evaluation_files(
            stage1_results,
            label_to_model,
        )
        agora_prompt = build_agora_file_ranking_prompt(
            user_query,
            agora_file_urls,
            language=language,
        )
        agora_messages = [{"role": "user", "content": agora_prompt}]
        for model in agora_models:
            model_messages[model] = agora_messages

    try:
        expected_labels = list(label_to_model.keys())
        responses = await query_model_messages_parallel(
            model_messages,
            on_model_complete=on_model_complete,
            timeout=PEER_EVALUATION_TIMEOUT_SECONDS,
            validate_response=lambda model, response: is_valid_peer_evaluation_response(
                model,
                response,
                expected_labels,
            ),
            max_attempts=PEER_EVALUATION_MAX_ATTEMPTS,
        )
    finally:
        cleanup_agora_evaluation_files(agora_token, agora_tmp_dir)

    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get("content", "")
            parsed = parse_ranking_from_text(full_text)
            parsed_scores = parse_agora_scores_from_text(full_text)
            if not is_valid_peer_evaluation_response(model, response, expected_labels):
                logger.error(
                    "[%s] Invalid peer evaluation; skipping. expected_labels=%s parsed_ranking=%s parsed_scores=%s content_preview=%r",
                    model,
                    expected_labels,
                    parsed,
                    parsed_scores,
                    full_text[:500],
                )
                continue
            result = {
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed,
            }
            if parsed_scores:
                result["parsed_scores"] = parsed_scores
            stage2_results.append(result)

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    chairman_model: str | None = None,
    language: str | None = None,
    personal_prompt: str | None = None,
    base_system_prompt: str | None = None,
    round2_stage1_results: List[Dict[str, Any]] | None = None,
    round2_stage2_results: List[Dict[str, Any]] | None = None,
    round2_finalists: List[str] | None = None,
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from round 1
        stage2_results: Rankings from round 1
        chairman_model: Optional override for chairman model
        personal_prompt: Optional user personalization prompt
        base_system_prompt: Optional override for company context
        round2_stage1_results: Optional revised finalist responses
        round2_stage2_results: Optional finalist rankings from round 2
        round2_finalists: Optional finalist model identifiers

    Returns:
        Dict with 'model' and 'response' keys
    """
    if LEADS_MODE:
        chairman_to_use = LEADS_CHAIRMAN_MODEL
    else:
        chairman_to_use = chairman_model or CHAIRMAN_MODEL

    round1_stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])
    round1_stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    round2_section = ""
    if round2_stage1_results:
        round2_stage1_text = "\n\n".join([
            f"Model: {result['model']}\nRevised Response: {result['response']}"
            for result in round2_stage1_results
        ])
        finalists_text = ", ".join(round2_finalists or [])
        round2_section = (
            f"\nROUND 2 - Finalists:\n{finalists_text or 'Not specified'}\n\n"
            "ROUND 2 - Finalist Revisions:\n"
            f"{round2_stage1_text}\n\n"
        )
        if round2_stage2_results:
            round2_stage2_text = "\n\n".join([
                f"Model: {result['model']}\nRanking: {result['ranking']}"
                for result in round2_stage2_results
            ])
            round2_section += (
                "ROUND 2 - Finalist Peer Rankings:\n"
                f"{round2_stage2_text}\n\n"
            )
        else:
            round2_section += (
                "ROUND 2 - Finalist Peer Rankings:\n"
                "No round-2 rankings were successfully returned.\n\n"
            )

    language_note = language_instruction(language)
    personalization = build_personalization_section(personal_prompt)
    context_block = ""
    if base_system_prompt:
        context_block = f"\nCONTEXT ABOUT OUR COMPANY:\n{base_system_prompt}\n"

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.
{context_block}
Original Question: {user_query}

ROUND 1 - Individual Responses:
{round1_stage1_text}

ROUND 1 - Peer Rankings:
{round1_stage2_text}
{round2_section}Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement
- If round 2 exists, treat round-2 finalist revisions as the freshest corrected drafts
- Preserve useful minority insights from round 1 even if those models were not finalists, when they add value
{personalization}

IMPORTANT FORMATTING RULES:
- When creating numbered lists, count items carefully and ensure the count in the header matches the actual number of items
- Double-check any "X items" or "X points" claims against the actual content
- Use consistent formatting throughout: either all bullet points or all numbered items within a section
- CRITICAL: All URLs must be formatted as proper Markdown links with descriptive text: [Link text](URL)
- Never output bare URLs - always wrap them in Markdown link syntax
- For demo/video links, use descriptive text like "Watch demo", "View demonstration", etc.

LANGUAGE SELECTION:
- Respond in the same language as the user's question
- If the question contains only a URL with no text, or its text is too short to determine the language:
  * Detect the predominant language of the scraped website/page content provided above and respond in that language
  * If website content is unavailable or its language cannot be determined: when the domain ends with .ru → respond in Russian, otherwise → respond in English

CLOSING SECTION:
After providing your comprehensive answer, conclude with the following (translate to the same language as your response).
Use proper markdown formatting with line breaks between each line:

---

**Make processes more efficient with Arteus.**

**We will prove to you that AI already works.**

**Contact us on Telegram: [@Leningrad84](https://t.me/Leningrad84) or [LinkedIn](https://www.linkedin.com/in/roman-nester-97b24755)**

Russian version:

**Делайте процессы эффективнее с Arteus.**

**Мы докажем вам, что AI уже работает.**

**Для связи Telegram: [@Leningrad84](https://t.me/Leningrad84) или [LinkedIn](https://www.linkedin.com/in/roman-nester-97b24755)**

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    if language_note:
        target_language = LANGUAGE_NAMES.get(language.lower(), "the user's language")
        chairman_prompt += f"\n\nRespond in {target_language}."

    messages = [{"role": "user", "content": chairman_prompt}]
    final_content = ""
    for attempt in range(1, FINAL_SYNTHESIS_MAX_ATTEMPTS + 1):
        response = await query_model(chairman_to_use, messages, temperature=0.7)
        final_content = str((response or {}).get("content") or "").strip()
        if final_content:
            break

        logger.warning(
            "[%s] Empty final synthesis response on attempt %s/%s",
            chairman_to_use,
            attempt,
            FINAL_SYNTHESIS_MAX_ATTEMPTS,
        )

    if not final_content:
        return {
            "model": chairman_to_use,
            "response": "Error: Unable to generate final synthesis.",
        }

    return {
        "model": chairman_to_use,
        "response": final_content,
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    if "FINAL RANKING:" in ranking_text:
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            numbered_matches = re.findall(r"\d+\.\s*Response [A-Z]", ranking_section)
            if numbered_matches:
                return _dedupe_labels([
                    re.search(r"Response [A-Z]", match).group()
                    for match in numbered_matches
                ])

            matches = re.findall(r"Response [A-Z]", ranking_section)
            return _dedupe_labels(matches)

    ranked_score_labels = [
        item["label"]
        for item in sorted(
            parse_agora_scores_from_text(ranking_text),
            key=lambda score: score["rank"],
        )
    ]
    if ranked_score_labels:
        return _dedupe_labels(ranked_score_labels)

    matches = re.findall(r"Response [A-Z]", ranking_text)
    return _dedupe_labels(matches)


def _dedupe_labels(labels: List[str]) -> List[str]:
    seen = set()
    deduped = []
    for label in labels:
        if label not in seen:
            seen.add(label)
            deduped.append(label)
    return deduped


def _parse_number(value: str) -> float | None:
    match = re.search(r"\d+(?:\.\d+)?", value)
    if not match:
        return None
    return float(match.group(0))


def parse_agora_scores_from_text(ranking_text: str) -> List[Dict[str, Any]]:
    """Parse Agora's simple score/rank/note evaluation lines."""
    scores = []
    seen_labels = set()

    for line in ranking_text.splitlines():
        label_match = re.search(r"\bResponse [A-Z]\b", line)
        if not label_match or "|" not in line:
            continue

        label = label_match.group(0)
        fields: Dict[str, str] = {}
        for part in line.split("|")[1:]:
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            fields[key.strip().lower()] = value.strip()

        score_value = _parse_number(fields.get("score", ""))
        rank_value = _parse_number(fields.get("rank", ""))
        if score_value is None or rank_value is None:
            continue

        if label in seen_labels:
            continue
        seen_labels.add(label)
        scores.append({
            "label": label,
            "score": int(score_value) if score_value.is_integer() else score_value,
            "rank": int(rank_value),
            "note": fields.get("note", ""),
        })

    return scores


def is_valid_agora_evaluation(
    ranking_text: str,
    expected_labels: List[str],
) -> bool:
    """Return whether Agora produced complete score/rank data for every response."""
    if not expected_labels:
        return False

    expected = set(expected_labels)
    scores = parse_agora_scores_from_text(ranking_text)
    score_labels = {item["label"] for item in scores}
    if score_labels != expected:
        return False

    ranks = [item["rank"] for item in scores]
    if len(set(ranks)) != len(expected):
        return False

    ranking = parse_ranking_from_text(ranking_text)
    return set(ranking) == expected and len(ranking) == len(expected)


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking["ranking"]
        parsed_ranking = ranking.get("parsed_ranking") or parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions),
            })

    aggregate.sort(key=lambda x: x["average_rank"])
    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        return "New Conversation"

    title = response.get("content", "New Conversation").strip()
    title = title.strip("\"'")
    if len(title) > 50:
        title = title[:47] + "..."
    return title


async def run_full_council(
    user_query: str,
    models: List[str] | None = None,
    chairman_model: str | None = None,
    language: str | None = None,
    personal_prompt: str | None = None,
    base_system_prompt: str | None = None,
    enable_second_round: bool = False,
) -> Tuple[List, List, Dict, Dict, List]:
    """
    Run the complete council process.

    Args:
        user_query: The user's question
        models: Optional override list of council models
        chairman_model: Optional override for chairman synthesis model
        language: Optional language preference
        personal_prompt: Optional user personalization prompt
        base_system_prompt: Optional override for company context
        enable_second_round: Whether to run the finalist rewrite/rerank loop

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata, rounds)
    """
    stage1_results = await stage1_collect_responses(
        user_query,
        models=models,
        language=language,
        base_system_prompt=base_system_prompt,
    )

    if not stage1_results:
        metadata = {
            "label_to_model": {},
            "aggregate_rankings": [],
            "second_round_enabled": enable_second_round,
            "second_round_status": "failed",
            "round2_finalists": [],
            "round2": None,
        }
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again.",
        }, metadata, []

    stage2_results, label_to_model = await stage2_collect_rankings(
        user_query,
        stage1_results,
        models=models,
        language=language,
        base_system_prompt=base_system_prompt,
    )

    round1_metadata = build_round_metadata(stage2_results, label_to_model)
    rounds = [build_round_payload(1, stage1_results, stage2_results, round1_metadata)]

    round2_stage1_results: List[Dict[str, Any]] = []
    round2_stage2_results: List[Dict[str, Any]] = []
    round2_metadata: Dict[str, Any] | None = None
    second_round_status = "skipped"
    finalists: List[str] = []

    if enable_second_round:
        finalists = select_second_round_finalists(
            stage1_results,
            round1_metadata["aggregate_rankings"],
        )

        if len(finalists) >= 2:
            try:
                round2_stage1_results = await stage1_collect_revised_responses(
                    user_query,
                    stage1_results,
                    stage2_results,
                    finalists,
                    round1_metadata["aggregate_rankings"],
                    language=language,
                    base_system_prompt=base_system_prompt,
                )

                if round2_stage1_results:
                    round2_ranking_models = get_peer_ranking_models([
                        result["model"] for result in round2_stage1_results
                    ])
                    round2_label_to_model = build_label_to_model(round2_stage1_results)
                    if round2_ranking_models:
                        round2_stage2_results, round2_label_to_model = await stage2_collect_rankings(
                            user_query,
                            round2_stage1_results,
                            models=round2_ranking_models,
                            language=language,
                            base_system_prompt=base_system_prompt,
                        )

                    round2_metadata = build_round_metadata(
                        round2_stage2_results,
                        round2_label_to_model,
                    )
                    rounds.append(
                        build_round_payload(
                            2,
                            round2_stage1_results,
                            round2_stage2_results,
                            round2_metadata,
                        )
                    )
                    second_round_status = calculate_second_round_status(
                        finalists,
                        round2_stage1_results,
                        round2_stage2_results,
                    )
                else:
                    second_round_status = "failed"
            except Exception:
                logger.exception("Second round failed unexpectedly")
                second_round_status = "failed"

    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        chairman_model=chairman_model,
        language=language,
        personal_prompt=personal_prompt,
        base_system_prompt=base_system_prompt,
        round2_stage1_results=round2_stage1_results,
        round2_stage2_results=round2_stage2_results,
        round2_finalists=finalists,
    )

    metadata = {
        "label_to_model": round1_metadata["label_to_model"],
        "aggregate_rankings": round1_metadata["aggregate_rankings"],
        "second_round_enabled": enable_second_round,
        "second_round_status": second_round_status,
        "round2_finalists": finalists,
        "round2": round2_metadata,
    }

    return stage1_results, stage2_results, stage3_result, metadata, rounds
