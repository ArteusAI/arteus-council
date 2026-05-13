import ModelLabel from './ModelLabel';
import { getModelDisplayName } from '../utils/modelDisplay';
import './ChatInterface.css';

export default function ChatControls({
  availableModels = [],
  selectedModels = [],
  onToggleModel,
  chairmanModel,
  onSelectChairman,
  baseSystemPrompt = '',
  baseSystemPromptId = 'custom',
  identityTemplates = [],
  onUpdateBaseSystemPrompt,
  modelsLoaded = false,
  language,
  t,
  hideIdentitySelector = false,
  leadsMode = false,
  showModelPicker = false,
  onToggleModelPicker,
  showBasePromptSettings = false,
  onToggleBasePromptSettings,
  onCloseBasePromptSettings,
  compact = false,
}) {
  const shortName = getModelDisplayName;
  const selectedShortNames = selectedModels.map(shortName);
  const selectionSummary = selectedShortNames.length
    ? `${selectedShortNames.slice(0, 3).join(', ')}${
        selectedShortNames.length > 3 ? ` +${selectedShortNames.length - 3}` : ''
      }`
    : t('selectionNone');
  const chairmanShortName = chairmanModel ? shortName(chairmanModel) : t('none');

  return (
    <div className={`model-controls${compact ? ' model-controls-compact' : ''}`}>
      <div className="model-controls-header">
        <div>
          <div className="model-controls-title">{t('councilTitle')}</div>
          <div className="model-controls-subtitle">
            {selectionSummary}{!leadsMode && ` • ${t('chairmanShort')}: ${chairmanShortName}`}
          </div>
        </div>
        <div className="model-controls-actions">
          <button
            type="button"
            className={`icon-button ${showModelPicker ? 'active' : ''} ${leadsMode ? 'with-text' : ''}`}
            onClick={onToggleModelPicker}
            aria-expanded={showModelPicker}
            title={t('chooseModels')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .52 5.888A3 3 0 1 0 12 15Z"/>
              <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.52 5.888A3 3 0 1 1 12 15Z"/>
              <path d="M12 5v14"/>
            </svg>
            {leadsMode && <span className="icon-button-label">{t('selectModels')}</span>}
          </button>
          {!hideIdentitySelector && (
            <button
              type="button"
              className={`icon-button settings-button ${showBasePromptSettings ? 'active' : ''}`}
              onClick={onToggleBasePromptSettings}
              title={t('basePromptSettings')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          )}
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
                  <ModelLabel model={model} className="model-pill-name" />
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

          {!leadsMode && (
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
          )}
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
                onClick={onCloseBasePromptSettings || onToggleBasePromptSettings}
              >
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
