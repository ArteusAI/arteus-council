/**
 * Detect bare Mermaid diagram blocks (without ```mermaid fences) in markdown
 * and wrap them in fenced code blocks so the renderer can pick them up.
 *
 * Handles the common case where an LLM outputs:
 *
 *     2. Целевая архитектура
 *     flowchart TB
 *         A --> B
 *         B --> C
 *
 * by converting the flowchart block into:
 *
 *     ```mermaid
 *     flowchart TB
 *         A --> B
 *         B --> C
 *     ```
 */

const MERMAID_START = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|C4Context|C4Container|C4Component|mindmap|timeline|requirementDiagram|quadrantChart|sankey-beta|block-beta|architecture-beta|packet-beta)\b/i;

function looksMermaidish(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('%%')) return true; // mermaid comment
  if (trimmed.startsWith('//')) return true;
  if (MERMAID_START.test(trimmed)) return true;
  if (/^(subgraph|end|style|classDef|class|linkStyle|click|direction|default|accentent|rect|autoNumber|autonumber|box|hide footbox|show footbox|title)\b/i.test(trimmed)) return true;
  if (/-->|---|==>|-\.->|==>|~~>|--x|--o|\.\.\.>|->|<-/.test(trimmed)) return true;
  if (/^\w[\w]*\s*[\[\(\{<\(\/\[].*[\]\)\}>\/\]\)]/.test(trimmed)) return true;
  if (/^\w[\w]*\s*--/.test(trimmed)) return true;
  return false;
}

export function wrapBareMermaidBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return markdown;

  const lines = markdown.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (MERMAID_START.test(line.trim())) {
      // Check we're not already inside a fenced code block
      const fenceCount = result.filter((l) => /^```/.test(l.trim())).length;
      if (fenceCount % 2 === 1) {
        result.push(line);
        i++;
        continue;
      }

      // Collect the mermaid block
      const block = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') {
          // Blank line — peek ahead: if the next non-blank line is not
          // mermaid-ish, the block ends here.
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length || !looksMermaidish(lines[j])) {
            break;
          }
          block.push(next);
          i++;
        } else if (looksMermaidish(next)) {
          block.push(next);
          i++;
        } else {
          break;
        }
      }

      result.push('```mermaid');
      result.push(...block);
      result.push('```');
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}
