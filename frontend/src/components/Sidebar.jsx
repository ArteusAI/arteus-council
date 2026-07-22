import { useState, useRef } from 'react';
import './Sidebar.css';
import DemosceneEasterEgg from './DemosceneEasterEgg';
import LogoBurst from './LogoBurst';
import PersonalizationSettings from './PersonalizationSettings';
import { primeDemosceneAudio } from '../utils/demosceneAudio';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onDeleteAllConversations,
  isOpen,
  theme,
  onToggleTheme,
  language,
  onLanguageChange,
  t,
  user,
  onLogout,
}) {
  const [showEasterEgg, setShowEasterEgg] = useState(false);
  const [showLogoBurst, setShowLogoBurst] = useState(false);
  const [showPersonalization, setShowPersonalization] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);

  const handleLogoClick = () => {
    if (showLogoBurst || showEasterEgg) {
      return;
    }

    clickCountRef.current += 1;

    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }

    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      primeDemosceneAudio();
      setShowLogoBurst(true);
      return;
    }

    clickTimerRef.current = setTimeout(() => {
      if (clickCountRef.current === 1) {
        onToggleTheme();
      }
      clickCountRef.current = 0;
    }, 400);
  };

  const handleDelete = (e, convId) => {
    e.stopPropagation();
    onDeleteConversation(convId);
  };

  const handleDeleteAll = () => {
    if (window.confirm(t('confirmDeleteAll'))) {
      onDeleteAllConversations();
    }
  };

  const baseUrl = import.meta.env.BASE_URL || '/';
  const logoSrc = theme === 'dark' 
    ? `${baseUrl}council_logo_black.png`
    : `${baseUrl}council_logo_white.png`;

  return (
    <div className={`sidebar ${isOpen ? 'open' : ''}`}>
      {showLogoBurst && (
        <LogoBurst
          onComplete={() => {
            setShowLogoBurst(false);
            setShowEasterEgg(true);
          }}
        />
      )}
      {showEasterEgg && (
        <DemosceneEasterEgg onClose={() => setShowEasterEgg(false)} />
      )}
      <PersonalizationSettings
        isOpen={showPersonalization}
        onClose={() => setShowPersonalization(false)}
        t={t}
        language={language}
      />
      <div className="sidebar-header">
        <div
          className="sidebar-brand"
          onClick={handleLogoClick}
          title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        >
          <img
            className="sidebar-logo"
            src={logoSrc}
            alt={t('appName')}
          />
          <div className="sidebar-title">{t('appName')}</div>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + {t('newConversation')}
        </button>
      </div>

      <div className="conversation-list">
        <div className="sidebar-search">
          <svg className="sidebar-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            className="sidebar-search-input"
            placeholder={t('searchConversations')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {(() => {
          const query = searchQuery.trim().toLowerCase();
          const filtered = query
            ? conversations.filter((c) =>
                (c.title || '').toLowerCase().includes(query)
              )
            : conversations;
          if (filtered.length === 0) {
            return (
              <div className="no-conversations">
                {query ? t('noSearchResults') : t('noConversations')}
              </div>
            );
          }
          return (
            <>
              {filtered.map((conv) => {
                const hasActiveJob = Boolean(conv.job_status);
                const jobProgress = Math.max(
                  0,
                  Math.min(100, Number(conv.job_progress ?? 3))
                );

                return (
                  <div
                    key={conv.id}
                    className={`conversation-item ${
                      conv.id === currentConversationId ? 'active' : ''
                    } ${hasActiveJob ? 'has-progress' : ''}`}
                    onClick={() => onSelectConversation(conv.id)}
                  >
                    <div className="conversation-content">
                      <div className="conversation-title">
                        {conv.title || 'New Conversation'}
                      </div>
                      <div className="conversation-meta">
                        {hasActiveJob ? (
                          <span className="conversation-job-status">
                            {t('jobRunning')} · {Math.round(jobProgress)}%
                          </span>
                        ) : (
                          `${conv.message_count} messages`
                        )}
                      </div>
                      {hasActiveJob && (
                        <div className="conversation-progress-track" aria-hidden="true">
                          <div
                            className="conversation-progress-fill"
                            style={{ width: `${jobProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      className="delete-btn"
                      onClick={(e) => handleDelete(e, conv.id)}
                      title={t('deleteChat')}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {filtered.length > 2 && !query && (
                <button className="delete-all-btn" onClick={handleDeleteAll}>
                  {t('deleteAllChats')}
                </button>
              )}
            </>
          );
        })()}
      </div>

      <div className="sidebar-footer">
        {user && (
          <div className="user-info">
            <span className="user-name" title={user.email}>
              {user.username || user.email}
            </span>
            <button className="logout-btn" onClick={onLogout} title={t('logout')}>
              {t('logout')}
            </button>
          </div>
        )}
        <div className="footer-controls">
          <button
            className="personalization-btn"
            onClick={() => setShowPersonalization(true)}
            title={t('personalization')}
            aria-label={t('personalization')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </button>
          <button 
            className="theme-toggle-btn" 
            onClick={onToggleTheme}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          
          <select 
            className="lang-select" 
            value={language} 
            onChange={(e) => onLanguageChange(e.target.value)}
          >
            <option value="en">EN</option>
            <option value="ru">RU</option>
            <option value="el">EL</option>
          </select>
        </div>
      </div>
    </div>
  );
}
