"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple, Optional
from .openrouter import query_models_parallel, query_model
from .config import (
    COUNCIL_MODELS,
    CHAIRMAN_MODEL,
    BASE_SYSTEM_PROMPT,
    LEADS_MODE,
    LEADS_CHAIRMAN_MODEL,
)


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
    return f"\n\nIMPORTANT STYLE INSTRUCTIONS:\nYou MUST strictly follow these instructions for the tone and style of your final response:\n{personal_prompt}\n"


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
    # Build prompt - only add context if system prompt is provided
    detailed_instruction = "\n\nPlease provide a comprehensive, detailed answer covering all nuances and aspects of the question."
    if base_system_prompt:
        prompt = f"CONTEXT:\n{base_system_prompt}\n\nQUESTION: {user_query}{detailed_instruction}{language_instruction(language)}"
    else:
        prompt = f"{user_query}{detailed_instruction}{language_instruction(language)}"
    messages = [{"role": "user", "content": prompt}]
    models_to_use = models or COUNCIL_MODELS

    # Query all models in parallel
    responses = await query_models_parallel(models_to_use, messages, on_model_complete=on_model_complete)

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


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

    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    language_note = language_instruction(language)
    
    ranking_prompt = f"""You are evaluating different responses to the following question.
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

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    responses = await query_models_parallel(models_to_use, messages, on_model_complete=on_model_complete)

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
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
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2
        chairman_model: Optional override for chairman model
        personal_prompt: Optional user personalization prompt
        base_system_prompt: Optional override for company context

    Returns:
        Dict with 'model' and 'response' keys
    """
    if LEADS_MODE:
        chairman_to_use = LEADS_CHAIRMAN_MODEL
    else:
        chairman_to_use = chairman_model or CHAIRMAN_MODEL

    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    language_note = language_instruction(language)
    personalization = build_personalization_section(personal_prompt)
    
    # Build context block only if system prompt is provided
    context_block = f"\nCONTEXT ABOUT OUR COMPANY:\n{base_system_prompt}\n" if base_system_prompt else ""
    
    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.
{context_block}
Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement
{personalization}

IMPORTANT FORMATTING RULES:
- When creating numbered lists, count items carefully and ensure the count in the header matches the actual number of items
- Double-check any "X items" or "X points" claims against the actual content
- Use consistent formatting throughout: either all bullet points or all numbered items within a section

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""
    if language_note:
        target_language = LANGUAGE_NAMES.get(language.lower(), "the user's language")
        chairman_prompt += f"\n\nRespond in {target_language}."

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model with lower temperature for more consistent output
    response = await query_model(chairman_to_use, messages, temperature=0.5)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": chairman_to_use,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": chairman_to_use,
        "response": response.get('content', '')
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

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
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

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

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

    # Use gemini-2.5-flash for title generation (fast and cheap)
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
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
) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question
        models: Optional override list of council models
        chairman_model: Optional override for chairman synthesis model
        language: Optional language preference
        personal_prompt: Optional user personalization prompt
        base_system_prompt: Optional override for company context

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(
        user_query,
        models=models,
        language=language,
        base_system_prompt=base_system_prompt
    )

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(
        user_query,
        stage1_results,
        models=models,
        language=language,
        base_system_prompt=base_system_prompt
    )

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results,
        chairman_model=chairman_model,
        language=language,
        personal_prompt=personal_prompt,
        base_system_prompt=base_system_prompt
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
