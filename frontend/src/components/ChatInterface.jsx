import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import ModelLabel from './ModelLabel';
import ChatControls from './ChatControls';
import { exportCouncilToPdf } from '../utils/exportPdf';
import { copyCouncilAsMarkdown } from '../utils/exportMarkdown';
import { getModelDisplayName } from '../utils/modelDisplay';
import './ChatInterface.css';

const markdownComponents = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
};

const BOTTOM_SCROLL_THRESHOLD = 80;

function ScrapedLinkCard({ link, t }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasMarkdown = link.markdown && link.markdown.length > 0;

  return (
    <div className={`scraped-link-card ${link.success ? '' : 'failed'} ${isExpanded ? 'expanded' : ''}`}>
      <div className="scraped-link-header">
        <span className="scraped-link-domain">{link.domain}</span>
        {!link.success && <span className="scraped-link-failed-badge">{t('scrapingFailed')}</span>}
        {link.success && hasMarkdown && (
          <button 
            className="scraped-link-expand-btn"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? t('collapseContent') : t('expandContent')}
          >
            <svg 
              width="16" 
              height="16" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className={isExpanded ? 'rotated' : ''}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        )}
      </div>
      {link.success && (
        <>
          <div className="scraped-link-title">
            {link.title || link.url}
          </div>
          {link.description && !isExpanded && (
            <div className="scraped-link-description">
              {link.description.length > 200 
                ? link.description.slice(0, 200) + '...' 
                : link.description
              }
            </div>
          )}
          {isExpanded && hasMarkdown && (
            <div className="scraped-link-markdown">
              <ReactMarkdown components={markdownComponents}>{link.markdown}</ReactMarkdown>
            </div>
          )}
        </>
      )}
      <a 
        href={link.url} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="scraped-link-url"
      >
        {link.url}
      </a>
    </div>
  );
}

function BrainGlyph({ count }) {
  return (
    <span className={`brain-glyph brain-glyph-${count}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <svg
          key={index}
          className="brain-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 4.5a3 3 0 0 0-3 3v.4A3.5 3.5 0 0 0 4.5 11c0 1.4.82 2.6 2 3.17V15A3.5 3.5 0 0 0 10 18.5h2v-14H9Z" />
          <path d="M15 4.5a3 3 0 0 1 3 3v.4a3.5 3.5 0 0 1 1.5 3.1c0 1.4-.82 2.6-2 3.17V15A3.5 3.5 0 0 1 14 18.5h-2v-14h3Z" />
          <path d="M9 9a1.75 1.75 0 0 1 1.75-1.75" />
          <path d="M15 9a1.75 1.75 0 0 0-1.75-1.75" />
          <path d="M9.25 13.25A1.75 1.75 0 0 0 11 15" />
          <path d="M14.75 13.25A1.75 1.75 0 0 1 13 15" />
        </svg>
      ))}
    </span>
  );
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  onRunNextRound,
  isLoading,
  availableModels,
  selectedModels,
  onToggleModel,
  chairmanModel,
  onSelectChairman,
  enableSecondRound,
  onSetSecondRound,
  baseSystemPrompt,
  baseSystemPromptId,
  identityTemplates,
  onUpdateBaseSystemPrompt,
  modelsLoaded,
  isConversationLoading = false,
  showConversationLoadingSpinner = false,
  language,
  t,
  hideIdentitySelector = false,
  leadsMode = false,
  leadsAnalysisBusy = false,
  modelAliases = {},
  showModelPicker = false,
  onToggleModelPicker,
  showBasePromptSettings = false,
  onToggleBasePromptSettings,
  onCloseBasePromptSettings,
  theme = 'dark',
}) {
  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const wasAtBottomRef = useRef(true);
  const lastConversationIdRef = useRef(undefined);
  const latestQuestionRef = useRef(null);
  const latestStage1Ref = useRef(null);
  const latestStage2Ref = useRef(null);
  const latestStage2FallbackRef = useRef(null);
  const latestStage3Ref = useRef(null);

  // In leads mode the entire input must be a single URL (with or without protocol).
  const urlOnlyPattern = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}([/?#][^\s]*)?$/i;
  const trimmedInput = input.trim();
  const hasUrl = urlOnlyPattern.test(trimmedInput);
  const leadsUrlRequired = leadsMode && !hasUrl && trimmedInput.length > 0;

  // Auto-resize textarea (skip for plain inputs used in leads mode)
  useEffect(() => {
    const el = textareaRef.current;
    if (el && el.tagName === 'TEXTAREA') {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input]);

  // Load draft when conversation changes
  useEffect(() => {
    if (conversation?.id) {
      let cancelled = false;
      try {
        const savedDraft = localStorage.getItem(`draft_${conversation.id}`);
        queueMicrotask(() => {
          if (!cancelled) {
            setInput(savedDraft || '');
          }
        });
      } catch (e) {
        console.warn('Failed to load draft', e);
      }
      return () => {
        cancelled = true;
      };
    }
  }, [conversation?.id]);

  // Save draft when input changes
  useEffect(() => {
    if (conversation?.id) {
      try {
        if (input) {
          localStorage.setItem(`draft_${conversation.id}`, input);
        } else {
          localStorage.removeItem(`draft_${conversation.id}`);
        }
      } catch (e) {
        console.warn('Failed to save draft', e);
      }
    }
  }, [input, conversation?.id]);

  const handleCopyMarkdown = async (userQuestion, msg, index) => {
    try {
      await copyCouncilAsMarkdown(userQuestion, msg, t);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const isMessagesAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= BOTTOM_SCROLL_THRESHOLD;
  }, []);

  const handleMessagesScroll = useCallback(() => {
    wasAtBottomRef.current = isMessagesAtBottom();
  }, [isMessagesAtBottom]);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    wasAtBottomRef.current = true;
  }, []);

  const scrollToAnchor = useCallback((ref, fallbackRef = null) => {
    const target = ref.current || fallbackRef?.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  useEffect(() => {
    const conversationId = conversation?.id ?? null;
    const didSwitchConversation = lastConversationIdRef.current !== conversationId;
    lastConversationIdRef.current = conversationId;

    if (didSwitchConversation) {
      scrollToBottom('auto');
      return;
    }

    if (wasAtBottomRef.current) {
      scrollToBottom();
    }
  }, [conversation, scrollToBottom]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (leadsMode && !hasUrl) return;
    if (leadsAnalysisBusy) return;
    if (input.trim() && !isLoading && selectedModels.length > 0 && modelsLoaded) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const shortName = getModelDisplayName;
  const formatModelList = (models = []) => models.map(shortName).join(', ');
  const selectedShortNames = selectedModels.map(shortName);
  const mobileSelectedSummary = selectedShortNames.length
    ? selectedShortNames.join(' · ')
    : t('selectionNone');
  const baseUrl = import.meta.env.BASE_URL || '/';
  const mobileLogoSrc = theme === 'dark'
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;
  const getUserQuestionForMessage = (messageIndex) => {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      if (conversation.messages[index]?.role === 'user') {
        return conversation.messages[index].content || '';
      }
    }
    return '';
  };
  const conversationLoadingOverlay = isConversationLoading ? (
    <div className="conversation-loading-overlay">
      {showConversationLoadingSpinner && (
        <div className="conversation-loading-spinner">
          <div className="spinner"></div>
        </div>
      )}
    </div>
  ) : null;

  if (!conversation) {
    return (
      <div className={`chat-interface ${isConversationLoading ? 'conversation-switching' : ''}`}>
        {conversationLoadingOverlay}
        <div className="empty-state">
          <h2>{t('welcomeTitle')}</h2>
          <p>{t('welcomeSubtitle')}</p>
        </div>
      </div>
    );
  }

  const lastAssistantMessage = conversation.messages
    .filter(m => m.role === 'assistant')
    .slice(-1)[0];

  const getRound = (msg, roundNumber) =>
    msg?.rounds?.find((round) => round.round === roundNumber) || null;

  const calculateProgress = (msg) => {
    if (!msg) return 0;
    const secondRoundEnabled = Boolean(msg.metadata?.second_round_enabled);
    const round2 = getRound(msg, 2);
    
    // Check from most advanced stage to least
    if (msg.stage3 !== null && !msg.loading?.stage3) return 100;
    if (msg.loading?.stage3) return secondRoundEnabled ? 95 : 92;
    
    if (round2?.stage2?.length) return 90;
    if (msg.loading?.round2Stage2) {
      const completed = msg.progress?.round2Stage2?.completed?.length || 0;
      const total = msg.progress?.round2Stage2?.total?.length || 1;
      return 75 + (completed / total) * 15;
    }

    if (round2?.stage1?.length) return 75;
    if (msg.loading?.round2Stage1) {
      const completed = msg.progress?.round2Stage1?.completed?.length || 0;
      const total = msg.progress?.round2Stage1?.total?.length || 1;
      return 55 + (completed / total) * 20;
    }

    if (msg.stage2 !== null) return secondRoundEnabled ? 55 : 85;
    if (msg.loading?.stage2) {
      const completed = msg.progress?.stage2?.completed?.length || 0;
      const total = msg.progress?.stage2?.total?.length || 1;
      const start = secondRoundEnabled ? 35 : 65;
      const end = secondRoundEnabled ? 55 : 85;
      return start + (completed / total) * (end - start);
    }
    
    if (msg.stage1 !== null) return secondRoundEnabled ? 35 : 60;
    if (msg.loading?.stage1) {
      const completed = msg.progress?.stage1?.completed?.length || 0;
      const total = msg.progress?.stage1?.total?.length || 1;
      const end = secondRoundEnabled ? 35 : 60;
      const startBase = msg.scrapedLinks !== null ? 15 : 10;
      return startBase + (completed / total) * (end - startBase);
    }
    
    if (msg.scrapedLinks !== null) return 15;
    if (msg.loading?.scraping) return 8;
    
    return 3; // Starting
  };

  const progress = isLoading ? calculateProgress(lastAssistantMessage) : 0;
  const latestCompletedAssistantIndex = conversation.messages.reduce((latest, msg, index) => {
    if (msg.role === 'assistant' && msg.stage3 && !msg.loading?.stage3) {
      return index;
    }
    return latest;
  }, -1);
  let latestQuestionIndex = -1;
  if (latestCompletedAssistantIndex > 0) {
    for (let index = latestCompletedAssistantIndex - 1; index >= 0; index -= 1) {
      if (conversation.messages[index]?.role === 'user') {
        latestQuestionIndex = index;
        break;
      }
    }
  }
  const hasJumpNav = latestCompletedAssistantIndex >= 0;

  return (
    <div className={`chat-interface ${isConversationLoading ? 'conversation-switching' : ''}`}>
      {conversationLoadingOverlay}
      <ChatControls
        availableModels={availableModels}
        selectedModels={selectedModels}
        onToggleModel={onToggleModel}
        chairmanModel={chairmanModel}
        onSelectChairman={onSelectChairman}
        baseSystemPrompt={baseSystemPrompt}
        baseSystemPromptId={baseSystemPromptId}
        identityTemplates={identityTemplates}
        onUpdateBaseSystemPrompt={onUpdateBaseSystemPrompt}
        modelsLoaded={modelsLoaded}
        language={language}
        t={t}
        hideIdentitySelector={hideIdentitySelector}
        leadsMode={leadsMode}
        showModelPicker={showModelPicker}
        onToggleModelPicker={onToggleModelPicker}
        showBasePromptSettings={showBasePromptSettings}
        onToggleBasePromptSettings={onToggleBasePromptSettings}
        onCloseBasePromptSettings={onCloseBasePromptSettings}
      />

      <div className="chat-mobile-topbar" aria-hidden="false">
        <div className="chat-mobile-topbar-brand">
          <img
            className="chat-mobile-topbar-logo"
            src={mobileLogoSrc}
            alt={t('appName')}
          />
          <span className="chat-mobile-topbar-title">{t('appName')}</span>
        </div>
        <div className="chat-mobile-topbar-models" title={mobileSelectedSummary}>
          {mobileSelectedSummary}
        </div>
      </div>

      <div className={`progress-bar-container ${isLoading ? 'visible' : ''}`}>
        <div 
          className="progress-bar-fill" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div
        ref={messagesContainerRef}
        className="messages-container"
        onScroll={handleMessagesScroll}
      >
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>{leadsMode ? t('emptyTitleLeads') : t('emptyTitle')}</h2>
            <p>{leadsMode ? t('emptySubtitleLeads') : t('emptySubtitle')}</p>
            {leadsMode && t('emptyResultLeads') && (
              <p className="empty-state-result">{t('emptyResultLeads')}</p>
            )}
          </div>
        ) : (
          conversation.messages.filter(Boolean).map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div
                  ref={index === latestQuestionIndex ? latestQuestionRef : null}
                  className="user-message chat-section-anchor"
                >
                  <div className="message-label">{t('youLabel')}</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown components={markdownComponents}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  {(() => {
                    const round1 = getRound(msg, 1);
                    const round2 = getRound(msg, 2);
                    const round1Stage1 = round1?.stage1 || msg.stage1;
                    const round1Stage2 = round1?.stage2 || msg.stage2;
                    const round1Metadata = round1?.metadata || msg.metadata;
                    const round2Stage1 = round2?.stage1 || [];
                    const round2Stage2 = round2?.stage2 || [];
                    const round2Metadata = round2?.metadata || msg.metadata?.round2;
                    const finalists = msg.metadata?.round2_finalists || [];
                    const isLatestCompletedAssistant = index === latestCompletedAssistantIndex;
                    const hasRound2Stage1 = round2Stage1.length > 0;
                    const hasRound2Stage2 = round2Stage2.length > 0;

                    return (
                      <>
                  {/* Scraped Links Info */}
                  {msg.scrapedLinks && msg.scrapedLinks.length > 0 && (
                    <div className="scraped-links-section">
                      {msg.scrapedLinks.map((link, linkIdx) => (
                        <ScrapedLinkCard key={linkIdx} link={link} t={t} />
                      ))}
                    </div>
                  )}

                  {/* Scraping Status */}
                  {msg.loading?.scraping && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>{t('scrapingLoading')}</span>
                    </div>
                  )}

                  <div className="message-label">{t('assistantLabel')}</div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading-container">
                      <div className="stage-loading">
                        <div className="spinner"></div>
                        <span>{t('stage1Loading')}</span>
                      </div>
                      {msg.progress?.stage1?.total?.length > 0 && (
                        <div className="model-progress-info">
                          <div className="model-progress-summary">
                            {msg.progress.stage1.completed.length} / {msg.progress.stage1.total.length} {t('modelsReady')}
                          </div>
                          <div className="model-progress-pills">
                            {msg.progress.stage1.total.map(modelId => {
                              const isCompleted = msg.progress.stage1.completed.includes(modelId);
                              return (
                                <span key={modelId} className={`model-progress-pill ${isCompleted ? 'completed' : 'pending'}`}>
                                  {isCompleted && <span className="check-icon">✓</span>}
                                  <ModelLabel model={modelId} />
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {round1Stage1 && (
                    <div
                      ref={isLatestCompletedAssistant && !hasRound2Stage1 ? latestStage1Ref : null}
                      className="chat-section-anchor"
                    >
                      <Stage1 responses={round1Stage1} t={t} />
                    </div>
                  )}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading-container">
                      <div className="stage-loading">
                        <div className="spinner"></div>
                        <span>{t('stage2Loading')}</span>
                      </div>
                      {msg.progress?.stage2?.total?.length > 0 && (
                        <div className="model-progress-info">
                          <div className="model-progress-summary">
                            {msg.progress.stage2.completed.length} / {msg.progress.stage2.total.length} {t('modelsRanked')}
                          </div>
                          <div className="model-progress-pills">
                            {msg.progress.stage2.total.map(modelId => {
                              const isCompleted = msg.progress.stage2.completed.includes(modelId);
                              return (
                                <span key={modelId} className={`model-progress-pill ${isCompleted ? 'completed' : 'pending'}`}>
                                  {isCompleted && <span className="check-icon">✓</span>}
                                  <ModelLabel model={modelId} />
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {round1Stage2 && (
                    <div
                      ref={isLatestCompletedAssistant && !hasRound2Stage2 ? latestStage2FallbackRef : null}
                      className="chat-section-anchor"
                    >
                      <Stage2
                        rankings={round1Stage2}
                        labelToModel={round1Metadata?.label_to_model}
                        aggregateRankings={round1Metadata?.aggregate_rankings}
                        aggregateRankingsRef={isLatestCompletedAssistant && !hasRound2Stage2 ? latestStage2Ref : null}
                        t={t}
                      />
                    </div>
                  )}

                  {/* Round 2 */}
                  {msg.loading?.round2Stage1 && (
                    <div className="stage-loading-container">
                      <div className="stage-loading">
                        <div className="spinner"></div>
                        <span>{t('round2Stage1Loading')}</span>
                      </div>
                      {msg.progress?.round2Stage1?.total?.length > 0 && (
                        <div className="model-progress-info">
                          <div className="model-progress-summary">
                            {msg.progress.round2Stage1.completed.length} / {msg.progress.round2Stage1.total.length} {t('modelsReady')}
                          </div>
                          <div className="model-progress-pills">
                            {msg.progress.round2Stage1.total.map(modelId => {
                              const isCompleted = msg.progress.round2Stage1.completed.includes(modelId);
                              return (
                                <span key={modelId} className={`model-progress-pill ${isCompleted ? 'completed' : 'pending'}`}>
                                  {isCompleted && <span className="check-icon">✓</span>}
                                  <ModelLabel model={modelId} />
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {round2Stage1.length > 0 && (
                    <>
                      {finalists.length > 0 && (
                        <div className="round-finalists">
                          {t('round2Finalists')}: {formatModelList(finalists)}
                        </div>
                      )}
                      <div
                        ref={isLatestCompletedAssistant ? latestStage1Ref : null}
                        className="chat-section-anchor"
                      >
                        <Stage1 responses={round2Stage1} title={t('round2Stage1Title')} t={t} />
                      </div>
                    </>
                  )}

                  {msg.loading?.round2Stage2 && (
                    <div className="stage-loading-container">
                      <div className="stage-loading">
                        <div className="spinner"></div>
                        <span>{t('round2Stage2Loading')}</span>
                      </div>
                      {msg.progress?.round2Stage2?.total?.length > 0 && (
                        <div className="model-progress-info">
                          <div className="model-progress-summary">
                            {msg.progress.round2Stage2.completed.length} / {msg.progress.round2Stage2.total.length} {t('modelsRanked')}
                          </div>
                          <div className="model-progress-pills">
                            {msg.progress.round2Stage2.total.map(modelId => {
                              const isCompleted = msg.progress.round2Stage2.completed.includes(modelId);
                              return (
                                <span key={modelId} className={`model-progress-pill ${isCompleted ? 'completed' : 'pending'}`}>
                                  {isCompleted && <span className="check-icon">✓</span>}
                                  <ModelLabel model={modelId} />
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {round2Stage2.length > 0 && (
                    <div
                      ref={isLatestCompletedAssistant ? latestStage2FallbackRef : null}
                      className="chat-section-anchor"
                    >
                      <Stage2
                        rankings={round2Stage2}
                        labelToModel={round2Metadata?.label_to_model}
                        aggregateRankings={round2Metadata?.aggregate_rankings}
                        aggregateRankingsRef={isLatestCompletedAssistant ? latestStage2Ref : null}
                        title={t('round2Stage2Title')}
                        t={t}
                      />
                    </div>
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>{t('stage3Loading')}</span>
                    </div>
                  )}
                  {msg.stage3 && (
                    <div
                      ref={index === latestCompletedAssistantIndex ? latestStage3Ref : null}
                      className="chat-section-anchor"
                    >
                      <Stage3 finalResponse={msg.stage3} t={t} />
                    </div>
                  )}

                  {/* Retry button for interrupted processing */}
                  {msg.stage3 && msg.stage3.response && msg.stage3.response.includes('Processing was interrupted') && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="action-button interrupted-retry-button"
                        onClick={() => {
                          const userMsg = conversation.messages[index - 1];
                          if (userMsg?.content) {
                            onSendMessage(userMsg.content);
                          }
                        }}
                        title={t('retryQuestion')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10"/>
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        {t('retryQuestion')}
                      </button>
                    </div>
                  )}

                  {/* Action bar - shown when stage 3 is complete */}
                  {msg.stage3 && !msg.loading?.stage3 && !msg.stage3.response?.includes('Processing was interrupted') && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          const userQuestion = getUserQuestionForMessage(index);
                          exportCouncilToPdf(userQuestion, msg, t);
                        }}
                        title={t('exportPdf')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="12" y1="18" x2="12" y2="12"/>
                          <line x1="9" y1="15" x2="15" y2="15"/>
                        </svg>
                        {t('exportPdf')}
                      </button>
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          const userQuestion = getUserQuestionForMessage(index);
                          handleCopyMarkdown(userQuestion, msg, index);
                        }}
                        title={t('copyMarkdown')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        {copiedIndex === index ? t('copiedToClipboard') : t('copyMarkdown')}
                      </button>
                      {!leadsMode &&
                        onRunNextRound &&
                        index === conversation.messages.length - 1 &&
                        !msg.metadata?.second_round_enabled &&
                        getUserQuestionForMessage(index) && (
                          <button
                            type="button"
                            className="action-button primary-action"
                            onClick={() => onRunNextRound(getUserQuestionForMessage(index))}
                            title={t('runNextRound')}
                            disabled={isLoading}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
                              <polyline points="21 3 21 9 15 9"/>
                            </svg>
                            {t('runNextRound')}
                          </button>
                        )}
                    </div>
                  )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>{t('consulting')}</span>
            <div className="loading-warning">{t('keepTabOpen')}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {hasJumpNav && (
        <div className="chat-jump-nav" aria-label={t('stage3Title')}>
          <button
            type="button"
            className="chat-jump-button"
            onClick={() => scrollToAnchor(latestQuestionRef)}
            title={t('youLabel')}
            aria-label={t('youLabel')}
            data-tooltip={t('youLabel')}
          >
            ?
          </button>
          <button
            type="button"
            className="chat-jump-button"
            onClick={() => scrollToAnchor(latestStage1Ref)}
            title={t('stage1Title')}
            aria-label={t('stage1Title')}
            data-tooltip={t('stage1Title')}
          >
            1
          </button>
          <button
            type="button"
            className="chat-jump-button"
            onClick={() => scrollToAnchor(latestStage2Ref, latestStage2FallbackRef)}
            title={t('aggregateRankings')}
            aria-label={t('aggregateRankings')}
            data-tooltip={t('aggregateRankings')}
          >
            2
          </button>
          <button
            type="button"
            className="chat-jump-button"
            onClick={() => scrollToAnchor(latestStage3Ref)}
            title={t('stage3Title')}
            aria-label={t('stage3Title')}
            data-tooltip={t('stage3Title')}
          >
            ✓
          </button>
        </div>
      )}

      {conversation.messages.length === 0 && (
        <div className={`input-form-container${leadsMode ? ' input-form-container-leads' : ''}`}>
          {leadsMode && (
            <div className="leads-url-prompt">
              {t('leadsUrlPromptTitle') || 'Provide a URL of your website to analyze your business profile'}
            </div>
          )}
          <form className="input-form" onSubmit={handleSubmit}>
            {leadsMode ? (
              <input
                ref={textareaRef}
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                className="message-input message-input-url"
                placeholder={t('askPlaceholderLeads') || 'https://your-website.com'}
                value={input}
                onChange={(e) => setInput(e.target.value.replace(/\s+/g, ''))}
                onKeyDown={handleKeyDown}
                disabled={isLoading || leadsAnalysisBusy || selectedModels.length === 0 || !modelsLoaded}
              />
            ) : (
              <textarea
                ref={textareaRef}
                className="message-input"
                placeholder={t('askPlaceholder')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || selectedModels.length === 0 || !modelsLoaded}
                rows={1}
              />
            )}
            <div className="input-actions">
              {!leadsMode && (
                <button
                  type="button"
                  className={`brain-mode-button ${enableSecondRound ? 'active' : ''}`}
                  onClick={() => onSetSecondRound(!enableSecondRound)}
                  aria-label={`${t('brainModeAriaLabel')}: ${enableSecondRound ? t('brainModeTwo') : t('brainModeOne')}`}
                  aria-pressed={enableSecondRound}
                  data-tooltip={enableSecondRound ? t('brainModeTwo') : t('brainModeOne')}
                  disabled={isLoading || selectedModels.length === 0 || !modelsLoaded}
                >
                  <BrainGlyph count={1} />
                </button>
              )}
              <button
                type="submit"
                className="send-button"
                disabled={
                  !input.trim() ||
                  isLoading ||
                  leadsAnalysisBusy ||
                  selectedModels.length === 0 ||
                  !modelsLoaded ||
                  (leadsMode && !hasUrl)
                }
              >
                {t('send')}
              </button>
            </div>
          </form>
          {leadsUrlRequired && (
            <div className="leads-url-note">
              {t('leadsUrlRequired') || 'Please include a URL in your message'}
            </div>
          )}
          {leadsMode && leadsAnalysisBusy && !isLoading && (
            <div className="leads-url-note">
              {t('leadsAnalysisBusy') || 'Analysis is already running. Please wait until it finishes.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
