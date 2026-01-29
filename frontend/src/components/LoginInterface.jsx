import { useState } from 'react';
import './LoginInterface.css';

function LoginInterface({ onLogin, error: externalError, t, theme, initialTelegram = '' }) {
  const [telegram, setTelegram] = useState(initialTelegram);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark' 
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  const validateTelegram = (value) => {
    const trimmedValue = value.trim();
    
    if (!trimmedValue.startsWith('@')) {
      return t?.('telegramMustStartWithAt') || 'Telegram username must start with @';
    }
    
    const username = trimmedValue.substring(1);
    if (username.length < 3) {
      return t?.('telegramTooShort') || 'Telegram username must be at least 5 characters after @';
    }
    
    const latinPattern = /^[a-zA-Z0-9_]+$/;
    if (!latinPattern.test(username)) {
      return t?.('telegramLatinOnly') || 'Telegram username must contain only latin letters, numbers, and underscores';
    }
    
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!telegram.trim() || !password.trim()) {
      setError(t?.('loginFieldsRequired') || 'Please provide Telegram and password');
      return;
    }

    const telegramError = validateTelegram(telegram);
    if (telegramError) {
      setError(telegramError);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await onLogin(telegram.trim(), password);
    } catch (err) {
      setError(err.message || t?.('loginFailed') || 'Login failed');
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
          <p className="login-subtitle">{t?.('loginSubtitle') || 'Sign in to continue'}</p>
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
              placeholder={t?.('telegramPlaceholder') || 'Enter your Telegram username'}
              disabled={isLoading}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">{t?.('password') || 'Password'}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t?.('passwordPlaceholder') || 'Enter your password'}
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>

          <button type="submit" className="login-button" disabled={isLoading}>
            {isLoading ? (t?.('signingIn') || 'Signing in...') : (t?.('signIn') || 'Sign In')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginInterface;
