import { useState, useRef } from 'react';
import './Sidebar.css';
import DemosceneEasterEgg from './DemosceneEasterEgg';
import PersonalizationSettings from './PersonalizationSettings';

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
  const [showPersonalization, setShowPersonalization] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);

  const handleLogoClick = () => {
    clickCountRef.current += 1;

    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
    }

    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      setShowEasterEgg(true);
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
            alt="Arteus Council logo"
          />
          <div className="sidebar-title">Arteus Council</div>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + {t('newConversation')}
        </button>
      </div>

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">{t('noConversations')}</div>
        ) : (
          <>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conversation-item ${
                  conv.id === currentConversationId ? 'active' : ''
                }`}
                onClick={() => onSelectConversation(conv.id)}
              >
                <div className="conversation-content">
                  <div className="conversation-title">
                    {conv.title || 'New Conversation'}
                  </div>
                  <div className="conversation-meta">
                    {conv.message_count} messages
                  </div>
                </div>
                <button
                  className="delete-btn"
                  onClick={(e) => handleDelete(e, conv.id)}
                  title={t('deleteChat')}
                >
                  ×
                </button>
              </div>
            ))}
            {conversations.length > 2 && (
              <button className="delete-all-btn" onClick={handleDeleteAll}>
                {t('deleteAllChats')}
              </button>
            )}
          </>
        )}
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
        <button
          className="personalization-btn"
          onClick={() => setShowPersonalization(true)}
          title={t('personalization')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          {t('personalization')}
        </button>
        <div className="footer-controls">
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
