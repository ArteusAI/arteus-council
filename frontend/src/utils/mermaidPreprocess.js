/**
 * Detect bare Mermaid diagram blocks (without ```mermaid fences) in markdown
 * and wrap them in fenced code blocks so the renderer can pick them up.
 *
 * Only wraps blocks that START with a recognised Mermaid keyword and whose
 * body lines look like genuine Mermaid syntax (multi-char arrows, node
 * definitions, keywords).  Regular prose with single-char arrows like
 * "A -> B" is NOT touched.
 */

const MERMAID_START =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|C4Context|C4Container|C4Component|mindmap|timeline|requirementDiagram|quadrantChart|sankey-beta|block-beta|architecture-beta|packet-beta)\b/i;

// Multi-char edge operators only — single `->` / `<-` are too common in prose.
const EDGE_RE = /-->|->>|-->>|==>|-\.->|~~>|--x|--o|\.\.\.>|==o|==x|<-->|---/;

// Mermaid structural keywords that can appear on their own line.
const KEYWORD_RE =
  /^(subgraph|end|style|classDef|class|linkStyle|click|direction|default|rect|autoNumber|autonumber|box|hide\s+footbox|show\s+footbox|title|loop|alt|else|opt|activate|deactivate|note|participant|actor|usecase|interface|package|node|database|cloud|frame|queue|stack|component|state|choice|concurrency|fork|join|split|merge|partition|if|then|else|elseif|endif|while|do|endwhile|repeat|until|break|continue|return|classNote|classNote|stateNote|note)\b/i;

/**
 * A line is a valid Mermaid continuation if it looks like genuine diagram
 * syntax — NOT regular prose that happens to contain an arrow.
 */
function isMermaidLine(line) {
  const t = line.trim();
  if (!t) return true; // blank lines are handled by the caller
  if (t.startsWith('%%')) return true; // mermaid comment
  if (t.startsWith('//')) return true; // some diagram types use // comments
  if (MERMAID_START.test(t)) return true;
  if (KEYWORD_RE.test(t)) return true;
  // Multi-char edge: "A --> B", "A ==> B"  (but NOT "A -> B" in prose)
  if (EDGE_RE.test(t)) return true;
  // Node definition: Word immediately followed by a shape bracket.
  // e.g.  A[Label], B(Label), C{Decision}, D[(Database)], E>Shape]
  if (/^\w[\w-]*\s*[\/\[\(\{<]/.test(t)) return true;
  // Assignment-style: "A -->|text| B"
  if (/^\w[\w-]*\s*--/.test(t)) return true;
  return false;
}

/**
 * Check that a collected block has enough mermaid content to be real
 * (at least one edge or one node definition beyond the start line).
 */
function hasMermaidContent(block) {
  if (block.length < 2) return false;
  for (let i = 1; i < block.length; i++) {
    const t = block[i].trim();
    if (EDGE_RE.test(t)) return true;
    if (/^\w[\w-]*\s*[\/\[\(\{<]/.test(t)) return true;
    if (KEYWORD_RE.test(t)) return true;
  }
  return false;
}

export function wrapBareMermaidBlocks(markdown) {
  if (!markdown || typeof markdown !== 'string') return markdown;

  const lines = markdown.split('\n');
  const result = [];
  let i = 0;
  let inFence = false;

  while (i < lines.length) {
    const line = lines[i];

    // Track fenced code blocks — don't touch content inside them.
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      result.push(line);
      i++;
      continue;
    }
    if (inFence) {
      result.push(line);
      i++;
      continue;
    }

    if (MERMAID_START.test(line.trim())) {
      // Collect the mermaid block.
      const block = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') {
          // Blank line — peek ahead.
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length || !isMermaidLine(lines[j])) {
            break;
          }
          block.push(next);
          i++;
        } else if (isMermaidLine(next)) {
          block.push(next);
          i++;
        } else {
          break;
        }
      }

      // Only wrap if the block has real mermaid content beyond the header.
      if (hasMermaidContent(block)) {
        result.push('```mermaid');
        result.push(...block);
        result.push('```');
      } else {
        // Not a real diagram — leave as-is.
        result.push(...block);
      }
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}
