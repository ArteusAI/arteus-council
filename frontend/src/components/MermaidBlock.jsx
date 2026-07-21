import { useEffect, useRef, useState, useId } from 'react';
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

export default function MermaidBlock({ chart }) {
  const containerRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${++renderCounter}`;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(renderId, chart);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setSvg('');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="mermaid-error">
        <details>
          <summary>Mermaid diagram error</summary>
          <pre>{chart}</pre>
        </details>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
