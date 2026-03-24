"""3-stage LLM Council orchestration."""

import asyncio
import logging
import math
from typing import Any, Dict, List, Optional, Tuple

from .config import CHAIRMAN_MODEL, COUNCIL_MODELS
from .llm import query_model, query_models_parallel

logger = logging.getLogger("llm-council.council")


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
    if base_system_prompt:
        return (
            f"CONTEXT:\n{base_system_prompt}\n\nQUESTION: {user_query}"
            f"{detailed_instruction}{language_instruction(language)}"
        )
    return f"{user_query}{detailed_instruction}{language_instruction(language)}"


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


def format_anonymized_responses(
    stage1_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> str:
    """Format responses using anonymous labels."""
    model_to_label = build_model_to_label(label_to_model)
    chunks = []
    for result in stage1_results:
        label = model_to_label.get(result["model"], result["model"])
        chunks.append(f"{label}:\n{result['response']}")
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
) -> str:
    """Build the peer-ranking prompt shared by stage 2 rounds."""
    language_note = language_instruction(language)
    return f"""You are evaluating different responses to the following question.
Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

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


async def query_model_messages_parallel(
    model_messages: Dict[str, List[Dict[str, str]]],
    on_model_complete: Optional[Any] = None,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """Query different models in parallel with model-specific messages."""

    async def _query_and_callback(model: str, messages: List[Dict[str, str]]):
        response = await query_model(model, messages)
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
            stage1_results.append({
                "model": model,
                "response": response.get("content", ""),
            })

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
            revised_results.append({
                "model": model,
                "response": response.get("content", ""),
            })
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
    models_to_use = models or COUNCIL_MODELS
    label_to_model = build_label_to_model(stage1_results)
    responses_text = format_anonymized_responses(stage1_results, label_to_model)
    ranking_prompt = build_ranking_prompt(user_query, responses_text, language=language)
    messages = [{"role": "user", "content": ranking_prompt}]

    responses = await query_models_parallel(
        models_to_use,
        messages,
        on_model_complete=on_model_complete,
    )

    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get("content", "")
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed,
            })

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
Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    if language_note:
        target_language = LANGUAGE_NAMES.get(language.lower(), "the user's language")
        chairman_prompt += f"\n\nRespond in {target_language}."

    messages = [{"role": "user", "content": chairman_prompt}]
    response = await query_model(chairman_to_use, messages)

    if response is None:
        return {
            "model": chairman_to_use,
            "response": "Error: Unable to generate final synthesis.",
        }

    return {
        "model": chairman_to_use,
        "response": response.get("content", ""),
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    if "FINAL RANKING:" in ranking_text:
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            numbered_matches = re.findall(r"\d+\.\s*Response [A-Z]", ranking_section)
            if numbered_matches:
                return [re.search(r"Response [A-Z]", match).group() for match in numbered_matches]

            matches = re.findall(r"Response [A-Z]", ranking_section)
            return matches

    matches = re.findall(r"Response [A-Z]", ranking_text)
    return matches


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
        parsed_ranking = parse_ranking_from_text(ranking_text)

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
                    round2_ranking_models = [
                        result["model"] for result in round2_stage1_results
                    ]
                    round2_label_to_model = build_label_to_model(round2_stage1_results)
                    if len(round2_ranking_models) >= 2:
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
