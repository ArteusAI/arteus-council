import { useState, useEffect, useRef } from 'react';
import './Sidebar.css';
import DemosceneEasterEgg from './DemosceneEasterEgg';

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
}) {
  const [showEasterEgg, setShowEasterEgg] = useState(false);
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

  return (
    <div className={`sidebar ${isOpen ? 'open' : ''}`}>
      {showEasterEgg && (
        <DemosceneEasterEgg onClose={() => setShowEasterEgg(false)} />
      )}
      <div className="sidebar-header">
        <div
          className="sidebar-brand"
          onClick={handleLogoClick}
          title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        >
          <img
            className="sidebar-logo"
            src="https://framerusercontent.com/images/G4MFpJVGo4QKdInsGAegy907Em4.png"
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
