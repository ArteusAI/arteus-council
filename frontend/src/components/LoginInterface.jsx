import { useState } from 'react';
import './LoginInterface.css';

function LoginInterface({ onLogin, error: externalError, t, theme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark' 
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError(t?.('loginFieldsRequired') || 'Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await onLogin(email, password);
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
            <label htmlFor="email">{t?.('email') || 'Email'}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t?.('emailPlaceholder') || 'Enter your email'}
              disabled={isLoading}
              autoComplete="email"
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
