function valueToText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function promoteSectionHeading(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 3 || lines[1].trim()) {
    return text.trim();
  }

  const firstLine = lines[0].trim();
  const match = firstLine.match(/^(\d+)\.\s+(.+)$/);
  if (match) {
    lines[0] = `## ${firstLine}`;
    return lines.join('\n').trim();
  }

  return text.trim();
}

function formatSection(section) {
  if (typeof section === 'string') {
    const text = section.trim();
    return text ? promoteSectionHeading(text) : null;
  }

  if (!section || typeof section !== 'object') {
    const text = valueToText(section).trim();
    return text || null;
  }

  const sectionType = String(section.type || '').trim().toLowerCase();
  const title = String(section.title || section.heading || '').trim();
  const text = String(section.markdown || section.text || section.content || '').trim();

  if ((sectionType === 'heading' || sectionType === 'title') && text) {
    return `## ${text}`;
  }

  const parts = [];
  if (title) {
    parts.push(`## ${title}`);
  }
  if (text) {
    parts.push(promoteSectionHeading(text));
  }

  if (Array.isArray(section.items)) {
    const itemLines = section.items
      .map((item) => valueToText(item).trim())
      .filter(Boolean)
      .map((item) => `- ${item}`);
    if (itemLines.length > 0) {
      parts.push(itemLines.join('\n'));
    }
  }

  return parts.join('\n\n').trim() || null;
}

function formatSourceRef(source) {
  if (!source || typeof source !== 'object') {
    const text = valueToText(source).trim();
    return text || null;
  }

  const sourceType = String(source.source_type || 'source').trim();
  const contextDocNum = source.context_doc_num;
  const contextSummaryNum = source.context_summary_num;
  const messageId = source.message_id;

  if (sourceType === 'document' && contextDocNum !== undefined && contextDocNum !== null) {
    return `document ${contextDocNum}`;
  }

  const bits = [];
  if (contextDocNum !== undefined && contextDocNum !== null) {
    bits.push(`document ${contextDocNum}`);
  }
  if (contextSummaryNum !== undefined && contextSummaryNum !== null) {
    bits.push(`summary ${contextSummaryNum}`);
  }
  if (messageId !== undefined && messageId !== null) {
    bits.push(`message ${messageId}`);
  }

  return `${sourceType} ${bits.join(', ')}`.trim();
}

function formatExplanations(explanations) {
  if (!Array.isArray(explanations) || explanations.length === 0) {
    return null;
  }

  const lines = ['## Sources and Notes'];
  explanations.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      const text = valueToText(item).trim();
      if (text) {
        lines.push(`${index + 1}. ${text}`);
      }
      return;
    }

    const explanation = String(item.explanation || '').trim();
    if (explanation) {
      lines.push(`${index + 1}. ${explanation}`);
    }

    if (Array.isArray(item.sources)) {
      const sources = item.sources.map(formatSourceRef).filter(Boolean);
      if (sources.length > 0) {
        const sourceText = `*Sources: ${sources.join('; ')}.*`;
        if (explanation) {
          lines.push(`   ${sourceText}`);
        } else {
          lines.push(`${index + 1}. ${sourceText}`);
        }
      }
    }
  });

  return lines.length > 1 ? lines.join('\n').trim() : null;
}

function structuredResponseToMarkdown(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  if (!Array.isArray(value.sections)) {
    return null;
  }

  const parts = value.sections.map(formatSection).filter(Boolean);
  const explanations = formatExplanations(value.explanations);
  if (explanations) {
    parts.push(`---\n\n${explanations}`);
  }

  return parts.join('\n\n').trim() || null;
}

function pythonLiteralToJsonish(text) {
  return text.replace(/'((?:\\.|[^'\\])*)'/g, (_match, content) => {
    const unescaped = content
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    return JSON.stringify(unescaped);
  });
}

function parseStructuredText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return null;
  }
  if (
    !trimmed.includes('sections') &&
    !trimmed.includes('response_kind') &&
    !trimmed.includes('explanations')
  ) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Agora has returned Python-repr-like payloads in some environments.
  }

  try {
    return JSON.parse(pythonLiteralToJsonish(trimmed));
  } catch {
    return null;
  }
}

export function formatResponseMarkdown(value) {
  const directMarkdown = structuredResponseToMarkdown(value);
  if (directMarkdown) {
    return directMarkdown;
  }

  const parsedMarkdown = structuredResponseToMarkdown(parseStructuredText(value));
  if (parsedMarkdown) {
    return parsedMarkdown;
  }

  return valueToText(value);
}
