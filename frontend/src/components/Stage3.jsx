import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import ModelLabel from './ModelLabel';
import { formatResponseMarkdown } from '../utils/responseMarkdown';
import './Stage3.css';

const STAGE3_ERROR = 'Error: Unable to generate final synthesis.';

export default function Stage3({ finalResponse, t, onRetry, isRetrying }) {
  const [copied, setCopied] = useState(false);

  if (!finalResponse) {
    return null;
  }

  const isError = finalResponse.response === STAGE3_ERROR;
  const responseMarkdown = isError
    ? `*${finalResponse.response}*`
    : formatResponseMarkdown(finalResponse.response);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(responseMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <div className="stage stage3">
      <h3 className="stage-title">{t('stage3Title')}</h3>
      <div className="final-response">
        <div className="chairman-label">
          {t('chairmanLabel')}: <ModelLabel model={finalResponse.model} />
        </div>
        <div className="final-text markdown-content">
          <ReactMarkdown>{responseMarkdown}</ReactMarkdown>
        </div>
        {isError && onRetry && (
          <button
            className="retry-stage3-btn"
            onClick={onRetry}
            disabled={isRetrying}
            title={t('retryStage3')}
          >
            {isRetrying ? (
              <>
                <span className="retry-spinner" />
                <span>{t('stage3Loading')}</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                <span>{t('retryStage3')}</span>
              </>
            )}
          </button>
        )}
        {!isError && (
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
        )}
      </div>
    </div>
  );
}
