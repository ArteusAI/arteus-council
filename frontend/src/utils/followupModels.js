export function selectFollowupFinalists(stage1 = [], rankings = []) {
  const stage1Models = stage1.map((result) => result.model).filter(Boolean);
  if (stage1Models.length === 0) return [];
  if (stage1Models.length <= 4) return stage1Models;

  const ranked = [];
  for (const item of rankings) {
    if (item?.model && stage1Models.includes(item.model) && !ranked.includes(item.model)) {
      ranked.push(item.model);
    }
  }
  for (const model of stage1Models) {
    if (!ranked.includes(model)) ranked.push(model);
  }

  const finalistCount = Math.min(
    5,
    Math.max(3, Math.ceil(stage1Models.length / 2)),
    stage1Models.length
  );
  return ranked.slice(0, finalistCount);
}

export function getFollowupLockedModels(conversation) {
  const messages = conversation?.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;

    const metadata = message.metadata || {};
    const stored = metadata.next_question_models || metadata.round2_finalists;
    if (Array.isArray(stored) && stored.length > 0) {
      return stored;
    }
    if (message.stage1 == null) {
      continue;
    }

    const rounds = message.rounds || [];
    const lastRound = rounds[rounds.length - 1];
    const stage1 = lastRound?.stage1 || message.stage1 || [];
    const rankings =
      lastRound?.metadata?.aggregate_rankings || metadata.aggregate_rankings || [];
    const computed = selectFollowupFinalists(stage1, rankings);
    return computed.length > 0 ? computed : null;
  }
  return null;
}

export function withConversationCostTotals(costStats, messages) {
  if (!costStats) return costStats;
  if (costStats.conversation_cost != null && costStats.conversation_tokens != null) {
    return costStats;
  }

  let conversationCost = 0;
  let conversationTokens = 0;
  for (const message of messages || []) {
    if (message?.role !== 'assistant') continue;
    const stats = message.metadata?.cost_stats;
    if (!stats) continue;
    conversationCost += stats.total_cost || 0;
    conversationTokens += stats.total_tokens || 0;
  }

  return {
    ...costStats,
    conversation_cost: conversationCost,
    conversation_tokens: conversationTokens,
  };
}
