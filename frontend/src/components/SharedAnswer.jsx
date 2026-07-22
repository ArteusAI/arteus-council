import { useState, useEffect } from 'react';
import { api } from '../api';
import { translations } from '../i18n';
import { getModelDisplayName } from '../utils/modelDisplay';
import { formatResponseMarkdown } from '../utils/responseMarkdown';
import MarkdownRenderer from './MarkdownRenderer';
import './SharedAnswer.css';

function detectLanguage() {
  const langs = navigator.languages || [navigator.language || 'en'];
  for (const lang of langs) {
    const code = lang.toLowerCase().split('-')[0];
    if (code === 'ru') return 'ru';
    if (code === 'el') return 'el';
  }
  return 'en';
}

function t(lang, key) {
  return translations[lang]?.[key] || translations.en[key] || key;
}

export default function SharedAnswer({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('arteusTheme') || 'light';
    } catch {
      return 'light';
    }
  });

  const lang = detectLanguage();

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(docHeight > 0 ? scrollTop / docHeight : 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [data]);

  // Allow the page to scroll: #root has overflow:hidden globally for the
  // main app, but the shared answer page needs document-level scroll.
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      root.style.overflow = 'auto';
      root.style.height = 'auto';
    }
    return () => {
      if (root) {
        root.style.overflow = '';
        root.style.height = '';
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('arteusTheme', theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.getSharedAnswer(token);
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark'
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  if (error) {
    return (
      <div className={`shared-answer-app ${theme}`}>
        <button className="shared-theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <div className="shared-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`shared-answer-app ${theme}`}>
        <button className="shared-theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <div className="shared-loading">
          <div className="shared-loading-spinner" />
        </div>
      </div>
    );
  }

  const responseMarkdown = formatResponseMarkdown(data.stage3?.response || '');
  const chairmanModel = data.stage3?.model || '';
  const rankings = data.aggregate_rankings || [];

  return (
    <div className={`shared-answer-app ${theme}`}>
      <button className="shared-theme-toggle" onClick={toggleTheme}>
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
      <div className="scroll-rail">
        <div
          className="scroll-rail-thumb"
          style={{ height: `${Math.max(3, scrollProgress * 100)}%` }}
        />
      </div>

      <div className="shared-container">
        <div className="shared-header">
          <img src={logoSrc} alt="Arteus" className="shared-logo" />
          <h1 className="shared-app-name">{t(lang, 'appName')}</h1>
        </div>

        {data.question && (
          <div className="shared-question">{data.question}</div>
        )}

        <div className="shared-answer-content">
          <MarkdownRenderer>{responseMarkdown}</MarkdownRenderer>
        </div>

        {rankings.length > 0 && (
          <details className="shared-details shared-details-bottom">
            <summary>{t(lang, 'winnersLabel')}</summary>
            <ol className="shared-rankings">
              {rankings.slice(0, 5).map((item, i) => (
                <li key={i}>
                  <span className="shared-ranking-model">
                    {getModelDisplayName(item.model)}
                  </span>
                  <span className="shared-ranking-score">
                    {' '}avg {item.average_rank} ({item.rankings_count} {t(lang, 'votes')})
                  </span>
                </li>
              ))}
            </ol>
            <div className="shared-chairman">
              {t(lang, 'chairmanLabel')}: {getModelDisplayName(chairmanModel)}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
