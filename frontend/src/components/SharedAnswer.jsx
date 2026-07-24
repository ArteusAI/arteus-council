import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api';
import { translations } from '../i18n';
import { getModelDisplayName } from '../utils/modelDisplay';
import { formatResponseMarkdown } from '../utils/responseMarkdown';
import MarkdownRenderer from './MarkdownRenderer';
import TOCMinimap from './TOCMinimap';
import LoginInterface from './LoginInterface';
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
  const [needsLogin, setNeedsLogin] = useState(false);
  const [tocItems, setTocItems] = useState([]);
  const contentRef = useRef(null);
  const railThumbRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('arteusTheme') || 'light';
    } catch {
      return 'light';
    }
  });

  const lang = detectLanguage();
  const translate = useCallback((key) => {
    if (key === 'loginSubtitle') return t(lang, 'shareLoginSubtitle');
    return t(lang, key);
  }, [lang]);

  // Scroll progress bar (right edge) — updated via ref to avoid
  // re-rendering the whole page (and remounting markdown) on every scroll
  useEffect(() => {
    const onScroll = () => {
      const fullHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = fullHeight > 0 ? window.scrollY / fullHeight : 0;
      if (railThumbRef.current) {
        railThumbRef.current.style.height = `${Math.max(3, progress * 100)}%`;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Allow the page to scroll. Also drop the 100vw width: once the vertical
  // scrollbar appears, 100vw exceeds the visible width -> horizontal scrollbar.
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      root.style.overflow = 'auto';
      root.style.height = 'auto';
      root.style.width = '100%';
    }
    return () => {
      if (root) {
        root.style.overflow = '';
        root.style.height = '';
        root.style.width = '';
      }
    };
  }, []);

  useEffect(() => {
    if (data?.title) {
      document.title = data.title;
    }
  }, [data]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('arteusTheme', theme);
    } catch {
      // localStorage unavailable
    }
  }, [theme]);

  const loadShared = useCallback(async () => {
    const result = await api.getSharedAnswer(token);
    setData(result);
    setError(null);
    setNeedsLogin(false);
    return result;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadShared();
      } catch (err) {
        if (!cancelled) {
          if (err.status === 401) {
            setNeedsLogin(true);
            setError(null);
          } else {
            setNeedsLogin(false);
            setError(err.message || 'Failed to load');
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, loadShared]);

  const handleLogin = async (email, password) => {
    await api.login(email, password);
    try {
      await loadShared();
    } catch (err) {
      if (err.status === 401) {
        setNeedsLogin(true);
        setError(null);
        throw new Error(t(lang, 'shareLoginSubtitle'));
      }
      setNeedsLogin(false);
      setError(err.message || 'Failed to load');
    }
  };

  // Extract TOC items from rendered headings (re-extract on theme change,
  // since re-rendered markdown replaces heading DOM elements)
  useEffect(() => {
    if (!data || !contentRef.current) return;
    // Small delay to let MarkdownRenderer + Mermaid finish rendering
    const timer = setTimeout(() => {
      const els = contentRef.current
        ? contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6')
        : [];
      const items = Array.from(els).map((el) => ({
        title: el.textContent || '',
        url: `#${el.id}`,
        depth: parseInt(el.tagName[1], 10),
      }));
      setTocItems(items);
    }, 400);
    return () => clearTimeout(timer);
  }, [data, theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark'
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  const actionButtons = (
    <div className="shared-actions">
      <button
        className="shared-action-btn"
        onClick={() => window.print()}
        title={t(lang, 'printPage')}
        aria-label={t(lang, 'printPage')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9V2h12v7"/>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
          <rect x="6" y="14" width="12" height="8"/>
        </svg>
      </button>
      <button className="shared-action-btn" onClick={toggleTheme} title="Theme">
        {theme === 'light' ? '🌙' : '☀️'}
      </button>
    </div>
  );

  if (needsLogin) {
    return (
      <div className={`shared-answer-app ${theme}`}>
        {actionButtons}
        <LoginInterface onLogin={handleLogin} t={translate} theme={theme} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`shared-answer-app ${theme}`}>
        {actionButtons}
        <div className="shared-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={`shared-answer-app ${theme}`}>
        {actionButtons}
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
      {actionButtons}

      {/* Scroll progress rail (right edge) */}
      <div className="scroll-rail">
        <div className="scroll-rail-thumb" ref={railThumbRef} />
      </div>

      {/* TOC minimap (right edge, hover to expand) */}
      <TOCMinimap items={tocItems} />

      <div className="shared-container">
        <div className="shared-header">
          <img src={logoSrc} alt="Arteus" className="shared-logo" />
          <h1 className="shared-app-name">{t(lang, 'appName')}</h1>
        </div>

        {data.question && (
          <div className="shared-question">{data.question}</div>
        )}

        <div className="shared-answer-content" ref={contentRef}>
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
