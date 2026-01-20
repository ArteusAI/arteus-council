import { useState, useEffect } from 'react';
import { api } from '../api';
import './PersonalizationSettings.css';

const TEMPLATE_KEYS = {
  default: 'templateDefault',
  concise: 'templateConcise',
  detailed: 'templateDetailed',
  beginner: 'templateBeginner',
  expert: 'templateExpert',
  code_focused: 'templateCodeFocused',
  creative: 'templateCreative',
  tractor: 'templateTractor',
  marketer: 'templateMarketer',
  custom: 'templateCustom',
};

export default function PersonalizationSettings({ isOpen, onClose, t, language }) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('default');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [templatesData, councilSettings] = await Promise.all([
        api.getPersonalizationTemplates(),
        api.getCouncilSettings(),
      ]);

      setTemplates(templatesData.templates || []);
      setSelectedTemplateId(councilSettings.template_id || 'default');
      setCustomPrompt(councilSettings.personal_prompt || '');
    } catch (error) {
      console.error('Failed to load personalization data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTemplateSelect = (templateId) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (template && templateId !== 'custom') {
      setCustomPrompt(template.prompt || '');
    }
  };

  const handleCustomPromptChange = (value) => {
    setCustomPrompt(value);
    if (value && selectedTemplateId !== 'custom') {
      const template = templates.find((t) => t.id === selectedTemplateId);
      if (template && value !== template.prompt) {
        setSelectedTemplateId('custom');
      }
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Get current settings to preserve base_system_prompt
      const settings = await api.getCouncilSettings();
      await api.setCouncilSettings(customPrompt, selectedTemplateId, settings.base_system_prompt);
      setShowSaved(true);
      setTimeout(() => {
        setShowSaved(false);
        onClose();
      }, 1000);
    } catch (error) {
      console.error('Failed to save personalization:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const getTemplateName = (template) => {
    if (language === 'ru' && template.name_ru) {
      return template.name_ru;
    }
    const key = TEMPLATE_KEYS[template.id];
    return key ? t(key) : template.name;
  };

  if (!isOpen) return null;

  return (
    <div className="personalization-overlay" onClick={onClose}>
      <div className="personalization-modal" onClick={(e) => e.stopPropagation()}>
        <div className="personalization-header">
          <h2>{t('personalizationSettings')}</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="personalization-content">
          {isLoading ? (
            <div className="loading-state">{t('loadingModels')}</div>
          ) : (
            <>
              <p className="personalization-desc">{t('personalizationDesc')}</p>

              <div className="template-section">
                <label className="section-label">{t('chooseTemplate')}</label>
                <div className="template-grid">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      className={`template-btn ${selectedTemplateId === template.id ? 'selected' : ''}`}
                      onClick={() => handleTemplateSelect(template.id)}
                    >
                      {getTemplateName(template)}
                    </button>
                  ))}
                  <button
                    className={`template-btn ${selectedTemplateId === 'custom' ? 'selected' : ''}`}
                    onClick={() => handleTemplateSelect('custom')}
                  >
                    {t('templateCustom')}
                  </button>
                </div>
              </div>

              <div className="custom-prompt-section">
                <label className="section-label">{t('customPrompt')}</label>
                <textarea
                  className="custom-prompt-input"
                  value={customPrompt}
                  onChange={(e) => handleCustomPromptChange(e.target.value)}
                  placeholder={t('customPromptPlaceholder')}
                  rows={4}
                />
              </div>
            </>
          )}
        </div>

        <div className="personalization-footer">
          {showSaved ? (
            <span className="saved-message">{t('personalizationSaved')}</span>
          ) : (
            <>
              <button className="cancel-btn" onClick={onClose} disabled={isSaving}>
                {t('cancelPersonalization')}
              </button>
              <button
                className="save-btn"
                onClick={handleSave}
                disabled={isSaving || isLoading}
              >
                {isSaving ? '...' : t('savePersonalization')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
