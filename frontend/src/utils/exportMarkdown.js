/**
 * Format council response as Markdown text for clipboard.
 */
export function formatCouncilAsMarkdown(userQuestion, assistantMessage, t) {
  const lines = [];
  const now = new Date();
  
  lines.push('# Arteus Council');
  lines.push('');
  lines.push(`*${now.toLocaleString()}*`);
  lines.push('');
  
  // Question
  lines.push(`## ${t('youLabel')}`);
  lines.push('');
  lines.push(userQuestion);
  lines.push('');
  
  // Final Answer (Stage 3)
  if (assistantMessage.stage3) {
    const chairmanName = assistantMessage.stage3.model?.split('/')[1] || assistantMessage.stage3.model || 'Chairman';
    lines.push(`## ${t('stage3Title')} (${chairmanName})`);
    lines.push('');
    lines.push(assistantMessage.stage3.response);
    lines.push('');
  }
  
  // Stage 1: Individual Responses
  const stage1Data = assistantMessage.stage1;
  if (stage1Data && (Array.isArray(stage1Data) ? stage1Data.length > 0 : Object.keys(stage1Data).length > 0)) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${t('stage1Title')}`);
    lines.push('');
    
    const entries = Array.isArray(stage1Data)
      ? stage1Data.map((item) => [item.model, item.response])
      : Object.entries(stage1Data);
    
    for (const [model, response] of entries) {
      const modelName = String(model).split('/')[1] || String(model);
      lines.push(`### ${modelName}`);
      lines.push('');
      const responseText = typeof response === 'string' ? response : String(response || '');
      lines.push(responseText);
      lines.push('');
    }
  }
  
  // Stage 2: Aggregate Rankings
  if (assistantMessage.metadata?.aggregate_rankings) {
    lines.push('---');
    lines.push('');
    lines.push(`## ${t('aggregateRankings')}`);
    lines.push('');
    
    const rankings = assistantMessage.metadata.aggregate_rankings;
    const sortedModels = Object.entries(rankings)
      .sort((a, b) => a[1].average - b[1].average);
    
    lines.push('| Model | Avg | Votes |');
    lines.push('|-------|-----|-------|');
    
    for (const [model, data] of sortedModels) {
      const modelName = model.split('/')[1] || model;
      lines.push(`| ${modelName} | ${data.average.toFixed(2)} | ${data.votes} |`);
    }
    lines.push('');
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

