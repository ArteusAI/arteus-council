import { useState, useEffect } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  t,
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
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
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">
                {conv.title || 'New Conversation'}
              </div>
              <div className="conversation-meta">
                {conv.message_count} messages
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
