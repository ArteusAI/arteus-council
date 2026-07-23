import { Children } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidBlock from './MermaidBlock';
import { wrapBareMermaidBlocks } from '../utils/mermaidPreprocess';

let slugCounter = 0;
const slugCache = new Map();

function slugify(children) {
  let text = '';
  if (typeof children === 'string') {
    text = children;
  } else if (Array.isArray(children)) {
    text = children.map((c) => (typeof c === 'string' ? c : '')).join('');
  } else {
    text = String(children || '');
  }
  text = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
  if (!text) return `h-${slugCounter++}`;

  if (slugCache.has(text)) {
    const count = slugCache.get(text) + 1;
    slugCache.set(text, count);
    return `${text}-${count}`;
  }
  slugCache.set(text, 1);
  return text;
}

// Module-level components map: CRITICAL for identity stability.
// If defined inline inside the component, every re-render creates new
// component functions -> React remounts the DOM elements -> any
// IntersectionObserver watching headings (TOC minimap) silently dies.
const markdownComponents = {
  pre({ node, children, ...props }) {
    // Mermaid blocks render their own container — skip the default <pre>
    // wrapper (its code-block background shows as a panel behind diagrams)
    const isMermaid = Children.toArray(children).some((c) =>
      c?.props?.className?.includes?.('language-mermaid')
    );
    if (isMermaid) {
      return <>{children}</>;
    }
    return <pre {...props}>{children}</pre>;
  },
  code({ node, inline, className, children, ...props }) {
    const text = String(children);
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : '';

    if (lang === 'mermaid') {
      return <MermaidBlock chart={text} />;
    }

    if (!inline && lang) {
      return (
        <pre className={`code-block language-${lang}`}>
          <code className={className} {...props}>{children}</code>
        </pre>
      );
    }

    return (
      <code className={className} {...props}>{children}</code>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
  h1: ({ node, children, ...props }) => <h1 id={slugify(children)} {...props}>{children}</h1>,
  h2: ({ node, children, ...props }) => <h2 id={slugify(children)} {...props}>{children}</h2>,
  h3: ({ node, children, ...props }) => <h3 id={slugify(children)} {...props}>{children}</h3>,
  h4: ({ node, children, ...props }) => <h4 id={slugify(children)} {...props}>{children}</h4>,
  h5: ({ node, children, ...props }) => <h5 id={slugify(children)} {...props}>{children}</h5>,
  h6: ({ node, children, ...props }) => <h6 id={slugify(children)} {...props}>{children}</h6>,
};

export default function MarkdownRenderer({ children, className }) {
  // Reset slug state per render so heading ids are deterministic
  // (otherwise re-renders, e.g. theme toggle, would suffix ids with -2, -3...)
  slugCounter = 0;
  slugCache.clear();

  const processed = typeof children === 'string'
    ? wrapBareMermaidBlocks(children)
    : children;

  return (
    <div className={className || 'markdown-content'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
