import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MermaidBlock from './MermaidBlock';
import { wrapBareMermaidBlocks } from '../utils/mermaidPreprocess';

export default function MarkdownRenderer({ children, className }) {
  const processed = typeof children === 'string'
    ? wrapBareMermaidBlocks(children)
    : children;

  return (
    <div className={className || 'markdown-content'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
