import { useState } from 'react';
import './LoginInterface.css';

function LeadsLoginInterface({ onRegister, error: externalError, t, theme, initialTelegram = '' }) {
  const [telegram, setTelegram] = useState(initialTelegram);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark' 
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!telegram.trim()) {
      setError(t?.('leadsContactRequired') || 'Please provide your Telegram');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await onRegister(null, telegram.trim());
    } catch (err) {
      setError(err.message || t?.('registrationFailed') || 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

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

          <div className="login-field">
            <label htmlFor="telegram">{t?.('telegram') || 'Telegram'}</label>
            <input
              id="telegram"
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder={t?.('telegramPlaceholder') || '@username'}
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
