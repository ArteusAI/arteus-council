import { useState, useRef, useEffect } from 'react';
import ModelLabel from './ModelLabel';
import MarkdownRenderer from './MarkdownRenderer';
import { formatResponseMarkdown } from '../utils/responseMarkdown';
import { api } from '../api';
import './Stage3.css';

const STAGE3_ERROR = 'Error: Unable to generate final synthesis.';

function formatTokens(n) {
  if (n == null) return 'n/a';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatCost(c) {
  if (c == null) return 'n/a';
  if (c < 0.01) return `$${c.toFixed(5)}`;
  if (c < 1) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}

const STAGE_LABELS = {
  stage1: 'Stage 1',
  stage2: 'Stage 2',
  stage3: 'Stage 3',
  round2_stage1: 'R2 Rev',
  round2_stage2: 'R2 Rank',
};

function CostStatsBadge({ costStats, t }) {
  const [expanded, setExpanded] = useState(false);
  if (!costStats) return null;

  const { total_cost, total_tokens, breakdown } = costStats;

  return (
    <div className="cost-stats-badge">
      <button
        type="button"
        className="cost-stats-toggle"
        onClick={() => setExpanded(!expanded)}
        title={t('costStatsBreakdown') || 'Cost breakdown'}
      >
        <span className="cost-stats-tokens">{formatTokens(total_tokens)} {t('costStatsTokens')}</span>
        <span className="cost-stats-sep">·</span>
        <span className="cost-stats-cost">{formatCost(total_cost)}</span>
      </button>
      {expanded && breakdown && (
        <div className="cost-stats-breakdown">
          <table>
            <thead>
              <tr>
                <th>{t('costStatsStage') || 'Stage'}</th>
                <th>{t('costStatsModel') || 'Model'}</th>
                <th>{t('costStatsPrompt') || 'Prompt'}</th>
                <th>{t('costStatsCompletion') || 'Completion'}</th>
                <th>{t('costStatsReasoning') || 'Reasoning'}</th>
                <th>{t('costStatsCost') || 'Cost'}</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((entry, i) => (
                <tr key={i}>
                  <td>{STAGE_LABELS[entry.stage] || entry.stage}</td>
                  <td className="cost-stats-model-cell">{entry.model}</td>
                  <td>{formatTokens(entry.prompt_tokens)}</td>
                  <td>{formatTokens(entry.completion_tokens)}</td>
                  <td>{formatTokens(entry.reasoning_tokens)}</td>
                  <td>{formatCost(entry.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Stage3({ finalResponse, t, onRetry, isRetrying, costStats, conversationId, messageIndex }) {
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareState, setShareState] = useState('idle'); // idle | creating | done | error
  const [shareUrl, setShareUrl] = useState('');
  const shareRef = useRef(null);

  useEffect(() => {
    if (!shareOpen) return;
    const onClick = (e) => {
      if (shareRef.current && !shareRef.current.contains(e.target)) {
        setShareOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [shareOpen]);

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

  const handleShare = async (requiresLogin) => {
    if (!conversationId || messageIndex == null) return;
    setShareOpen(false);
    setShareState('creating');
    try {
      const result = await api.createShare(conversationId, messageIndex, requiresLogin);
      const basePath = import.meta.env.BASE_URL || '/';
      const shareUrl = `${window.location.origin}${basePath}share/${result.token}`;
      setShareUrl(shareUrl);
      await navigator.clipboard.writeText(shareUrl);
      setShareState('done');
      setTimeout(() => setShareState('idle'), 4000);
    } catch (err) {
      console.error('Failed to create share link:', err);
      setShareState('error');
      setTimeout(() => setShareState('idle'), 4000);
    }
  };

  return (
    <div className="stage stage3">
      <h3 className="stage-title">{t('stage3Title')}</h3>
      <div className="final-response">
        <div className="chairman-label">
          {t('chairmanLabel')}: <ModelLabel model={finalResponse.model} />
        </div>
        {costStats && <CostStatsBadge costStats={costStats} t={t} />}
        <div className="final-text">
          <MarkdownRenderer>{responseMarkdown}</MarkdownRenderer>
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
          <div className="final-actions">
            {conversationId && messageIndex != null && (
              <div className="share-wrapper" ref={shareRef}>
                <button
                  className={`copy-response-btn share-btn ${shareState !== 'idle' ? shareState : ''}`}
                  onClick={() => shareState === 'idle' && setShareOpen(!shareOpen)}
                  disabled={shareState === 'creating'}
                  title={shareState === 'done' ? t('shareLinkCopied') : t('share')}
                >
                  {shareState === 'creating' ? (
                    <>
                      <span className="retry-spinner" />
                      <span>{t('share')}</span>
                    </>
                  ) : shareState === 'done' ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      <span>{t('shareLinkCopied')}</span>
                    </>
                  ) : shareState === 'error' ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                      <span>{t('share')}</span>
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3"/>
                        <circle cx="6" cy="12" r="3"/>
                        <circle cx="18" cy="19" r="3"/>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                      </svg>
                      <span>{t('share')}</span>
                    </>
                  )}
                </button>
                {shareOpen && (
                  <div className="share-dropdown">
                    <button
                      className="share-option"
                      onClick={() => handleShare(false)}
                    >
                      {t('sharePublic')}
                    </button>
                    <button
                      className="share-option"
                      onClick={() => handleShare(true)}
                    >
                      {t('shareRequiresLogin')}
                    </button>
                  </div>
                )}
              </div>
            )}
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
        )}
      </div>
    </div>
  );
}
