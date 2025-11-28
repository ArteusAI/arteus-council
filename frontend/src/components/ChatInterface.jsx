import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import { exportCouncilToPdf } from '../utils/exportPdf';
import './ChatInterface.css';

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
  modelsLoaded,
  t,
}) {
  const [input, setInput] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const messagesEndRef = useRef(null);

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
              className="pill-button"
              onClick={() => setShowModelPicker((prev) => !prev)}
              aria-expanded={showModelPicker}
            >
              {showModelPicker ? t('hideModels') : t('chooseModels')}
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
                  <div className="message-label-row">
                    <div className="message-label">{t('assistantLabel')}</div>
                    {msg.stage3 && !msg.loading?.stage3 && (
                      <button
                        type="button"
                        className="export-pdf-button"
                        onClick={() => {
                          const userMsg = conversation.messages[index - 1];
                          const userQuestion = userMsg?.content || '';
                          exportCouncilToPdf(userQuestion, msg, t);
                        }}
                        title={t('exportPdf')}
                      >
                        {t('exportPdf')}
                      </button>
                    )}
                  </div>

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>{t('stage1Loading')}</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} t={t} />}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>{t('stage2Loading')}</span>
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
            className="message-input"
            placeholder={t('askPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || selectedModels.length === 0 || !modelsLoaded}
            rows={3}
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
