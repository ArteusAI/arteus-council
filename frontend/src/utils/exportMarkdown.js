import { getModelDisplayName } from './modelDisplay';

function getRound(assistantMessage, roundNumber) {
  return assistantMessage.rounds?.find((round) => round.round === roundNumber) || null;
}

function formatResponsesSection(lines, title, stageData) {
  if (!stageData || stageData.length === 0) {
    return;
  }

  lines.push('---');
  lines.push('');
  lines.push(`## ${title}`);
  lines.push('');

  for (const item of stageData) {
    const modelName = getModelDisplayName(item.model);
    lines.push(`### ${modelName}`);
    lines.push('');
    lines.push(item.response || '');
    lines.push('');
  }
}

function formatAggregateSection(lines, title, rankings) {
  if (!Array.isArray(rankings) || rankings.length === 0) {
    return;
  }

  lines.push('---');
  lines.push('');
  lines.push(`## ${title}`);
  lines.push('');
  lines.push('| Model | Avg | Votes |');
  lines.push('|-------|-----|-------|');

  for (const item of rankings) {
    const modelName = getModelDisplayName(item.model);
    const avg = typeof item.average_rank === 'number'
      ? item.average_rank.toFixed(2)
      : 'N/A';
    const votes = item.rankings_count ?? 0;
    lines.push(`| ${modelName} | ${avg} | ${votes} |`);
  }

  lines.push('');
}

/**
 * Format council response as Markdown text for clipboard.
 */
export function formatCouncilAsMarkdown(userQuestion, assistantMessage, t) {
  const lines = [];
  const now = new Date();
  const round1 = getRound(assistantMessage, 1);
  const round2 = getRound(assistantMessage, 2);
  const round1Stage1 = round1?.stage1 || assistantMessage.stage1 || [];
  const round1Rankings = round1?.metadata?.aggregate_rankings
    || assistantMessage.metadata?.aggregate_rankings
    || [];
  const round2Stage1 = round2?.stage1 || [];
  const round2Rankings = round2?.metadata?.aggregate_rankings
    || assistantMessage.metadata?.round2?.aggregate_rankings
    || [];

  lines.push(`# ${t('appName')}`);
  lines.push('');
  lines.push(`*${now.toLocaleString()}*`);
  lines.push('');
  lines.push(`## ${t('youLabel')}`);
  lines.push('');
  lines.push(userQuestion);
  lines.push('');

  if (assistantMessage.stage3) {
    const chairmanName = getModelDisplayName(assistantMessage.stage3.model || 'Chairman');
    lines.push(`## ${t('stage3Title')} (${chairmanName})`);
    lines.push('');
    lines.push(assistantMessage.stage3.response);
    lines.push('');
  }

  formatResponsesSection(lines, t('stage1Title'), round1Stage1);
  formatAggregateSection(lines, t('aggregateRankings'), round1Rankings);

  if (round2Stage1.length > 0) {
    formatResponsesSection(lines, t('round2Stage1Title'), round2Stage1);
    formatAggregateSection(lines, t('round2Stage2Title'), round2Rankings);
  }

  return lines.join('\n');
}

/**
 * Copy council response as Markdown to clipboard.
 */
export async function copyCouncilAsMarkdown(userQuestion, assistantMessage, t) {
  const markdown = formatCouncilAsMarkdown(userQuestion, assistantMessage, t);
  await navigator.clipboard.writeText(markdown);
  return markdown;
}
