import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import './Stage3.css';

const markdownComponents = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
};

export default function Stage3({ finalResponse, t, modelAliases = {} }) {
  const [copied, setCopied] = useState(false);

  if (!finalResponse) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(finalResponse.response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const getModelName = (model) => modelAliases[model] || model.split('/')[1] || model;

  return (
    <div className="stage stage3">
      <h3 className="stage-title">{t('stage3Title')}</h3>
      <div className="final-response">
        <div className="final-text markdown-content">
          <ReactMarkdown components={markdownComponents}>{finalResponse.response}</ReactMarkdown>
        </div>
        <button 
          className={`copy-response-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title={t('copyAnswer')}
        >
          {copied ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>{t('copiedToClipboard')}</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>{t('copyAnswer')}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
