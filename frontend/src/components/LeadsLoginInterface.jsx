import { useState } from 'react';
import './LoginInterface.css';

const CONTACT_TYPES = {
  LINKEDIN: 'linkedin',
  TELEGRAM: 'telegram',
};

function LeadsLoginInterface({ onRegister, error: externalError, t, theme, initialTelegram = '' }) {
  const [contactType, setContactType] = useState(
    initialTelegram ? CONTACT_TYPES.TELEGRAM : CONTACT_TYPES.LINKEDIN
  );
  const [value, setValue] = useState(initialTelegram || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark'
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  const validateTelegram = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('@')) {
      return t?.('telegramMustStartWithAt') || 'Telegram username must start with @';
    }
    const username = trimmed.substring(1);
    if (username.length < 5) {
      return t?.('telegramTooShort') || 'Telegram username must be at least 5 characters after @';
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return t?.('telegramLatinOnly') || 'Telegram username must contain only latin letters, numbers, and underscores';
    }
    return null;
  };

  const validateLinkedin = (raw) => {
    const trimmed = raw.trim();
    const slug = /^[a-zA-Z0-9-]{3,100}$/;
    const url = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]{3,100}\/?$/i;
    if (slug.test(trimmed) || url.test(trimmed)) {
      return null;
    }
    return t?.('linkedinInvalid') || 'Enter LinkedIn slug or https://linkedin.com/in/<slug>';
  };

  const handleTypeChange = (type) => {
    if (type === contactType) return;
    setContactType(type);
    setValue('');
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!value.trim()) {
      setError(t?.('leadsContactRequired') || 'Please provide Telegram or LinkedIn');
      return;
    }

    const validationError =
      contactType === CONTACT_TYPES.TELEGRAM
        ? validateTelegram(value)
        : validateLinkedin(value);

    if (validationError) {
      setError(validationError);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const trimmed = value.trim();
      if (contactType === CONTACT_TYPES.TELEGRAM) {
        await onRegister(null, trimmed, null);
      } else {
        await onRegister(null, null, trimmed);
      }
    } catch (err) {
      setError(err.message || t?.('registrationFailed') || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const isLinkedin = contactType === CONTACT_TYPES.LINKEDIN;
  const inputLabel = isLinkedin
    ? (t?.('linkedin') || 'LinkedIn')
    : (t?.('telegram') || 'Telegram');
  const inputPlaceholder = isLinkedin
    ? (t?.('linkedinPlaceholder') || 'https://linkedin.com/in/your-slug')
    : (t?.('telegramPlaceholder') || '@username');

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <img
            src={logoSrc}
            alt="Logo"
            className="login-logo"
          />
          <h1 className="login-title">{t?.('appName') || 'Arteus Council'}</h1>
          <p className="login-subtitle">{t?.('leadsSubtitle') || 'Enter your contact to continue'}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {(error || externalError) && (
            <div className="login-error">{error || externalError}</div>
          )}

          <div className="login-contact-type">
            <button
              type="button"
              className={`login-contact-type-button${isLinkedin ? ' is-active' : ''}`}
              onClick={() => handleTypeChange(CONTACT_TYPES.LINKEDIN)}
              disabled={isLoading}
            >
              {t?.('linkedin') || 'LinkedIn'}
            </button>
            <button
              type="button"
              className={`login-contact-type-button${!isLinkedin ? ' is-active' : ''}`}
              onClick={() => handleTypeChange(CONTACT_TYPES.TELEGRAM)}
              disabled={isLoading}
            >
              {t?.('telegram') || 'Telegram'}
            </button>
          </div>

          <div className="login-field">
            <label htmlFor="lead-contact">{inputLabel}</label>
            <input
              id="lead-contact"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={inputPlaceholder}
              disabled={isLoading}
              autoComplete="off"
              autoFocus
            />
          </div>

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? (t?.('continuing') || 'Continuing...') : (t?.('continue') || 'Continue')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LeadsLoginInterface;
