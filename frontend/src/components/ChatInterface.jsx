import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import { exportCouncilToPdf } from '../utils/exportPdf';
import { copyCouncilAsMarkdown } from '../utils/exportMarkdown';
import './ChatInterface.css';

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
              <ReactMarkdown>{link.markdown}</ReactMarkdown>
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

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  availableModels,
  selectedModels,
  onToggleModel,
  onResetModels,
  chairmanModel,
  onSelectChairman,
  baseSystemPrompt,
  baseSystemPromptId,
  identityTemplates,
  onUpdateBaseSystemPrompt,
  modelsLoaded,
  language,
  t,
}) {
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showBasePromptSettings, setShowBasePromptSettings] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${scrollHeight}px`;
    }
  }, [input]);

  // Load draft when conversation changes
  useEffect(() => {
    if (conversation?.id) {
      try {
        const savedDraft = localStorage.getItem(`draft_${conversation.id}`);
        setInput(savedDraft || '');
      } catch (e) {
        console.warn('Failed to load draft', e);
      }
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading && selectedModels.length > 0 && modelsLoaded) {
      onSendMessage(input);
      // Draft is removed by the useEffect that watches input when it's set to empty
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

  const shortName = (model) => model.split('/')[1] || model;
  const selectedShortNames = selectedModels.map(shortName);
  const selectionSummary = selectedShortNames.length
    ? `${selectedShortNames.slice(0, 3).join(', ')}${
        selectedShortNames.length > 3 ? ` +${selectedShortNames.length - 3}` : ''
      }`
    : t('selectionNone');
  const chairmanShortName = chairmanModel ? shortName(chairmanModel) : t('none');

  if (!conversation) {
    return (
      <div className="chat-interface">
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

  const calculateProgress = (msg) => {
    if (!msg) return 0;
    
    // Check from most advanced stage to least
    if (msg.stage3 !== null && !msg.loading?.stage3) return 100;
    if (msg.loading?.stage3) return 92;
    
    if (msg.stage2 !== null) return 85;
    if (msg.loading?.stage2) {
      const completed = msg.progress?.stage2?.completed?.length || 0;
      const total = msg.progress?.stage2?.total?.length || 1;
      return 65 + (completed / total) * 20; // 65% to 85%
    }
    
    if (msg.stage1 !== null) return 60;
    if (msg.loading?.stage1) {
      const completed = msg.progress?.stage1?.completed?.length || 0;
      const total = msg.progress?.stage1?.total?.length || 1;
      // Start from 10% (or 15% if scraped) and go to 60%
      const startBase = msg.scrapedLinks !== null ? 15 : 10;
      return startBase + (completed / total) * (60 - startBase);
    }
    
    if (msg.scrapedLinks !== null) return 15;
    if (msg.loading?.scraping) return 8;
    
    return 3; // Starting
  };

  const progress = isLoading ? calculateProgress(lastAssistantMessage) : 0;

  return (
    <div className="chat-interface">
      <div className="model-controls">
        <div className="model-controls-header">
          <div>
            <div className="model-controls-title">{t('councilTitle')}</div>
            <div className="model-controls-subtitle">
              {selectionSummary} • {t('chairmanShort')}: {chairmanShortName}
            </div>
          </div>
          <div className="model-controls-actions">
            <button
              type="button"
              className={`icon-button ${showModelPicker ? 'active' : ''}`}
              onClick={() => setShowModelPicker((prev) => !prev)}
              aria-expanded={showModelPicker}
              title={t('chooseModels')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .52 5.888A3 3 0 1 0 12 15Z"/>
                <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.52 5.888A3 3 0 1 1 12 15Z"/>
                <path d="M12 5v14"/>
              </svg>
            </button>
            <button
              type="button"
              className={`icon-button settings-button ${showBasePromptSettings ? 'active' : ''}`}
              onClick={() => setShowBasePromptSettings((prev) => !prev)}
              title={t('basePromptSettings')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>
        </div>

        {showModelPicker && (
          <div className="model-collapsible">
            {!modelsLoaded && (
              <div className="model-loading">
                {t('loadingModels')}
              </div>
            )}
            
            <div className="model-pill-grid">
              {availableModels.map((model) => {
                const selected = selectedModels.includes(model);
                return (
                  <label
                    key={model}
                    className={`model-pill ${selected ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleModel(model)}
                    />
                    <span className="model-pill-check" aria-hidden="true">
                      {selected ? '✓' : ''}
                    </span>
                    <span className="model-pill-name">{shortName(model)}</span>
                  </label>
                );
              })}
              {availableModels.length === 0 && (
                <div className="model-empty">{t('noModelsConfigured')}</div>
              )}
            </div>

            {selectedModels.length === 0 && (
              <div className="model-warning">{t('selectAtLeastOne')}</div>
            )}

            <div className="chairman-row">
              <label className="chairman-label" htmlFor="chairman-select">
                {t('chairmanModel')}
              </label>
              <select
                id="chairman-select"
                className="chairman-select"
                value={chairmanModel}
                onChange={(e) => onSelectChairman(e.target.value)}
                disabled={!availableModels.length}
              >
                {[...new Set([chairmanModel, ...availableModels].filter(Boolean))].map((model) => (
                  <option key={model} value={model}>
                    {shortName(model)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {showBasePromptSettings && (
          <div className="model-collapsible base-prompt-settings">
            <div className="settings-section">
              <div className="settings-header">
                <h3>{t('basePromptTitle')}</h3>
              </div>
              <p className="settings-description">{t('basePromptDesc')}</p>
              
              <div className="template-grid identity-template-grid">
                {identityTemplates.map((template) => (
                  <button
                    key={template.id}
                    className={`template-btn ${baseSystemPromptId === template.id ? 'selected' : ''}`}
                    onClick={() => onUpdateBaseSystemPrompt(template.prompt, template.id)}
                  >
                    {language === 'ru' ? template.name_ru : template.name}
                  </button>
                ))}
                <button
                  className={`template-btn ${baseSystemPromptId === 'custom' ? 'selected' : ''}`}
                  onClick={() => {
                    // If switching from a template to custom, clear the prompt
                    if (baseSystemPromptId !== 'custom') {
                      onUpdateBaseSystemPrompt('', 'custom');
                    }
                  }}
                >
                  {t('basePromptCustom')}
                </button>
              </div>

              <textarea
                className="base-prompt-textarea"
                value={baseSystemPrompt}
                onChange={(e) => onUpdateBaseSystemPrompt(e.target.value, 'custom')}
                placeholder={t('basePromptPlaceholder')}
                rows={6}
              />
              <div className="settings-footer">
                <button 
                  className="pill-button"
                  onClick={() => setShowBasePromptSettings(false)}
                >
                  {t('close')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={`progress-bar-container ${isLoading ? 'visible' : ''}`}>
        <div 
          className="progress-bar-fill" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>

      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>{t('emptyTitle')}</h2>
            <p>{t('emptySubtitle')}</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">{t('youLabel')}</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
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
                              const modelName = modelId.split('/')[1] || modelId;
                              return (
                                <span key={modelId} className={`model-progress-pill ${isCompleted ? 'completed' : 'pending'}`}>
                                  {isCompleted && <span className="check-icon">✓</span>}
                                  {modelName}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} t={t} />}

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
                              const modelName = modelId.split('/')[1] || modelId;
                              return (
                                <span key={modelId} className={`model-progress-pill ${isCompleted ? 'completed' : 'pending'}`}>
                                  {isCompleted && <span className="check-icon">✓</span>}
                                  {modelName}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                      t={t}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>{t('stage3Loading')}</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} t={t} />}

                  {/* Action bar - shown when stage 3 is complete */}
                  {msg.stage3 && !msg.loading?.stage3 && (
                    <div className="message-actions">
                      <button
                        type="button"
                        className="action-button"
                        onClick={() => {
                          const userMsg = conversation.messages[index - 1];
                          const userQuestion = userMsg?.content || '';
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
                          const userMsg = conversation.messages[index - 1];
                          const userQuestion = userMsg?.content || '';
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
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>{t('consulting')}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {conversation.messages.length === 0 && (
        <form className="input-form" onSubmit={handleSubmit}>
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
          <button
            type="submit"
            className="send-button"
            disabled={
              !input.trim() ||
              isLoading ||
              selectedModels.length === 0 ||
              !modelsLoaded
            }
          >
            {t('send')}
          </button>
        </form>
      )}
    </div>
  );
}
