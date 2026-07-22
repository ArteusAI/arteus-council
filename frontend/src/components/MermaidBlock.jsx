import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    fontFamily: 'inherit',
    fontSize: '14px',
    primaryColor: '#4a90e2',
    primaryTextColor: '#fff',
    primaryBorderColor: '#357abd',
    lineColor: '#666',
    secondaryColor: '#f0f0f0',
    tertiaryColor: '#fff',
    background: '#fff',
    mainBkg: '#4a90e2',
    secondBkg: '#f0f0f0',
    textColor: '#333',
  },
  flowchart: {
    htmlLabels: true,
    curve: 'basis',
    padding: 12,
  },
  securityLevel: 'loose',
});

let renderCounter = 0;

function cleanupMermaidErrors() {
  document.querySelectorAll('body > div[id^="dmermaid-"]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('.mermaid-error, [class*="mermaid"][class*="error"]').forEach((el) => {
    if (el.tagName === 'DIV' && el.parentElement === document.body) {
      el.remove();
    }
  });
}

export default function MermaidBlock({ chart }) {
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mmd-${++renderCounter}`;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(renderId, chart);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
          cleanupMermaidErrors();
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
          setSvg('');
          cleanupMermaidErrors();
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupMermaidErrors();
    };
  }, [chart]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (failed) {
    return (
      <pre className="code-block mermaid-fallback">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <>
      <div className="mermaid-container">
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        {svg && (
          <button
            className="mermaid-expand-btn"
            onClick={() => setExpanded(true)}
            title="Expand"
            aria-label="Expand diagram"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6"/>
              <path d="M9 21H3v-6"/>
              <path d="M21 3l-7 7"/>
              <path d="M3 21l7-7"/>
            </svg>
          </button>
        )}
      </div>
      {expanded && svg && (
        <div className="mermaid-fullscreen-overlay" onClick={() => setExpanded(false)}>
          <div
            className="mermaid-fullscreen-content"
            onClick={(e) => e.stopPropagation()}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <button
            className="mermaid-fullscreen-close"
            onClick={() => setExpanded(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
