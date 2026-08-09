import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

// Neutral "council" palettes — matched to the app's CSS variables
const LIGHT_VARS = {
  fontFamily: 'inherit',
  fontSize: '14px',
  background: 'transparent',
  primaryColor: '#f5f7fa',
  primaryTextColor: '#333333',
  primaryBorderColor: '#d1d5db',
  lineColor: '#9ca3af',
  secondaryColor: '#eef2f7',
  tertiaryColor: '#ffffff',
  mainBkg: '#f5f7fa',
  secondBkg: '#eef2f7',
  textColor: '#333333',
  clusterBkg: '#fafafa',
  edgeLabelBackground: '#ffffff',
  noteBkgColor: '#f5f5f5',
  noteTextColor: '#333333',
  noteBorderColor: '#d1d5db',
  actorBkg: '#f5f7fa',
  actorBorder: '#d1d5db',
  actorTextColor: '#333333',
  signalColor: '#6b7280',
  signalTextColor: '#333333',
  labelBoxBkgColor: '#f5f7fa',
  labelTextColor: '#333333',
  loopTextColor: '#6b7280',
};

const DARK_VARS = {
  fontFamily: 'inherit',
  fontSize: '14px',
  background: 'transparent',
  primaryColor: '#1a1a1a',
  primaryTextColor: '#e5e5e5',
  primaryBorderColor: '#3a3a3a',
  lineColor: '#6b7280',
  secondaryColor: '#222222',
  tertiaryColor: '#161616',
  mainBkg: '#1a1a1a',
  secondBkg: '#222222',
  textColor: '#e5e5e5',
  clusterBkg: '#141414',
  edgeLabelBackground: '#0a0a0a',
  noteBkgColor: '#1a1a1a',
  noteTextColor: '#e5e5e5',
  noteBorderColor: '#3a3a3a',
  actorBkg: '#1a1a1a',
  actorBorder: '#3a3a3a',
  actorTextColor: '#e5e5e5',
  signalColor: '#9ca3af',
  signalTextColor: '#e5e5e5',
  labelBoxBkgColor: '#1a1a1a',
  labelTextColor: '#e5e5e5',
  loopTextColor: '#9ca3af',
};

function initializeMermaid(mode) {
  mermaid.initialize({
    startOnLoad: false,
    // Prevent Mermaid from injecting the "bomb / Syntax error" SVG into <body>
    // on parse/render failure — we handle errors ourselves with a code fallback.
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: mode === 'dark' ? DARK_VARS : LIGHT_VARS,
    flowchart: {
      htmlLabels: true,
      curve: 'basis',
      padding: 12,
    },
    securityLevel: 'loose',
  });
}

// Track the app's data-theme attribute so diagrams re-render on theme switch
function useDocumentTheme() {
  const [mode, setMode] = useState(() =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  );
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMode(
        document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return mode;
}

let renderCounter = 0;

/** Remove leftover Mermaid temp/error nodes that may linger on <body>. */
function cleanupMermaidDom(renderId) {
  // Temp wrapper is "d" + render id (e.g. dmmd-1); error SVG uses the render id itself.
  const ids = [];
  if (renderId) {
    ids.push(renderId, `d${renderId}`);
  }
  for (const id of ids) {
    document.getElementById(id)?.remove();
  }
  document.querySelectorAll('body > div[id^="dmmd-"], body > svg[id^="mmd-"]').forEach((el) => {
    el.remove();
  });
  document.querySelectorAll('body > div[id^="dmermaid-"], body > svg[aria-roledescription="error"]').forEach((el) => {
    el.remove();
  });
}

/** True when Mermaid returned its built-in error diagram instead of throwing. */
function isMermaidErrorSvg(svg) {
  if (!svg) return false;
  return (
    svg.includes('Syntax error') ||
    svg.includes('aria-roledescription="error"') ||
    /mermaid-error|error-icon/i.test(svg)
  );
}

export default function MermaidBlock({ chart }) {
  const containerRef = useRef(null);
  const fullscreenRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mode = useDocumentTheme();

  useEffect(() => {
    let cancelled = false;
    const renderId = `mmd-${++renderCounter}`;

    (async () => {
      try {
        initializeMermaid(mode);
        const { svg: rendered } = await mermaid.render(renderId, chart);
        cleanupMermaidDom(renderId);
        if (cancelled) return;
        if (isMermaidErrorSvg(rendered)) {
          setFailed(true);
          setSvg('');
          return;
        }
        setSvg(rendered);
        setFailed(false);
      } catch {
        cleanupMermaidDom(renderId);
        if (!cancelled) {
          setFailed(true);
          setSvg('');
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupMermaidDom(renderId);
    };
  }, [chart, mode]);

  // Fit the inline diagram to the column: natural width when it fits,
  // scaled down (via viewBox ratio) when it would overflow — no scrollbars.
  useEffect(() => {
    if (!svg) return;
    const fit = () => {
      const container = containerRef.current;
      const svgEl = container?.querySelector('svg');
      if (!container || !svgEl) return;
      const vbW = svgEl.viewBox?.baseVal?.width;
      if (!vbW) return;
      const avail = container.clientWidth - 2;
      if (avail <= 0) return;
      const w = Math.min(vbW, avail);
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      svgEl.style.maxWidth = '100%';
      svgEl.style.width = `${Math.round(w)}px`;
      svgEl.style.height = 'auto';
    };
    fit();
    const t1 = setTimeout(fit, 0);
    const t2 = setTimeout(fit, 50);
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(fit)
      : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', fit);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [svg]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  // Fit the fullscreen diagram to the viewport. Mermaid SVGs carry an inline
  // `max-width: Npx` style (natural size) which beats stylesheet rules and
  // prevents scaling up — so we set explicit pixel width/height here.
  useEffect(() => {
    if (!expanded || !svg) return;
    const fit = () => {
      const svgEl = fullscreenRef.current?.querySelector('svg');
      if (!svgEl) return;
      let w = svgEl.viewBox?.baseVal?.width;
      let h = svgEl.viewBox?.baseVal?.height;
      if (!w || !h) {
        const rect = svgEl.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
      }
      if (!w || !h) return;
      const availW = window.innerWidth * 0.94 - 32;
      const availH = window.innerHeight * 0.92 - 32;
      const scale = Math.min(availW / w, availH / h);
      svgEl.style.maxWidth = 'none';
      svgEl.style.width = `${Math.round(w * scale)}px`;
      svgEl.style.height = `${Math.round(h * scale)}px`;
    };
    // Wait a tick so the overlay DOM is mounted
    const raf = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, [expanded, svg]);

  if (failed) {
    return (
      <pre className="code-block mermaid-fallback">
        <code>{chart}</code>
      </pre>
    );
  }

  return (
    <>
      <div className="mermaid-container" ref={containerRef}>
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
            ref={fullscreenRef}
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
