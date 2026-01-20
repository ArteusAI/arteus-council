import { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import LoginInterface from './components/LoginInterface';
import { api } from './api';
import { translate } from './i18n';
import './App.css';

const normalizeLang = (code) => {
  if (!code) return 'en';
  const lower = code.toLowerCase();
  if (lower.startsWith('ru')) return 'ru';
  if (lower.startsWith('el') || lower.startsWith('gr')) return 'el';
  return 'en';
};

function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [ipBypassed, setIpBypassed] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(() => {
    try {
      return localStorage.getItem('arteusCurrentConversationId') || null;
    } catch (e) {
      return null;
    }
  });
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const logoUrl = 'https://framerusercontent.com/images/G4MFpJVGo4QKdInsGAegy907Em4.png';
  const [language, setLanguage] = useState('ru');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('arteusTheme') || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('arteusTheme', theme);
    } catch (e) {
      console.warn('Theme save failed', e);
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('arteusLang');
      if (savedLang) {
        setLanguage(normalizeLang(savedLang));
        return;
      }
      // Default to RU if no saved language
      setLanguage('ru');
      localStorage.setItem('arteusLang', 'ru');
    } catch (e) {
      console.warn('Language load failed', e);
    }
  }, []);

  const setLanguageSafe = (code) => {
    const normalized = normalizeLang(code);
    setLanguage(normalized);
    try {
      localStorage.setItem('arteusLang', normalized);
    } catch (e) {
      console.warn('Language save failed', e);
    }
  };

  const t = (key) => translate(language, key);

  // Check authentication on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const data = await api.getMe();
        setIpBypassed(data.ip_bypassed || false);
        if (data.authenticated) {
          setUser(data.user);
        }
      } catch (error) {
        console.warn('Auth check failed:', error);
      } finally {
        setAuthChecked(true);
      }
    };
    checkAuth();
  }, []);

  const handleLogin = async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
  };

  const handleLogout = useCallback(() => {
    api.logout();
    setUser(null);
    setConversations([]);
    setCurrentConversationId(null);
    setCurrentConversation(null);
  }, []);

  // Load conversations when authenticated
  useEffect(() => {
    if (!authChecked) return;
    if (!user && !ipBypassed) return;
    loadConversations();
    loadModels();
  }, [authChecked, user, ipBypassed]);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  // Save current conversation ID to localStorage when it changes
  useEffect(() => {
    try {
      if (currentConversationId) {
        localStorage.setItem('arteusCurrentConversationId', currentConversationId);
      } else {
        localStorage.removeItem('arteusCurrentConversationId');
      }
    } catch (e) {
      console.warn('Failed to save current conversation ID', e);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);

      // Validate currentConversationId if it exists
      if (currentConversationId && !convs.find(c => c.id === currentConversationId)) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadModels = async () => {
    try {
      const data = await api.listModels();
      const councilList = data.council_models || [];
      setAvailableModels(councilList);

      // Try to load saved models from sessionStorage
      let savedModels = null;
      let savedChairman = null;
      try {
        const savedModelsStr = window.sessionStorage.getItem('arteusSelectedModels');
        const savedChairmanStr = window.sessionStorage.getItem('arteusChairmanModel');
        if (savedModelsStr) {
          savedModels = JSON.parse(savedModelsStr);
          // Validate saved models are still available
          savedModels = savedModels.filter((m) => councilList.includes(m));
          if (savedModels.length === 0) savedModels = null;
        }
        if (savedChairmanStr && councilList.includes(savedChairmanStr)) {
          savedChairman = savedChairmanStr;
        }
      } catch (e) {
        console.warn('Failed to load saved models', e);
      }

      if (savedModels) {
        setSelectedModels(savedModels);
      } else {
        // Default to selecting all available models
        setSelectedModels(councilList);
      }

      if (savedChairman) {
        setChairmanModel(savedChairman);
      } else {
        const defaultPreferred =
          data.default_preferred_models || [];
        const defaultSelection = councilList.filter((m) =>
          defaultPreferred.includes(m)
        );
        const chairmanCandidate =
          data.chairman_model ||
          defaultSelection[0] ||
          councilList[0] ||
          '';
        setChairmanModel(chairmanCandidate);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setModelsLoaded(true);
    }
  };

  // Save selected models to sessionStorage when they change
  useEffect(() => {
    if (!modelsLoaded) return;
    try {
      window.sessionStorage.setItem('arteusSelectedModels', JSON.stringify(selectedModels));
    } catch (e) {
      console.warn('Failed to save selected models', e);
    }
  }, [selectedModels, modelsLoaded]);

  // Save chairman model to sessionStorage when it changes
  useEffect(() => {
    if (!modelsLoaded || !chairmanModel) return;
    try {
      window.sessionStorage.setItem('arteusChairmanModel', chairmanModel);
    } catch (e) {
      console.warn('Failed to save chairman model', e);
    }
  }, [chairmanModel, modelsLoaded]);

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at, message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  const handleDeleteAllConversations = async () => {
    try {
      await api.deleteAllConversations();
      setConversations([]);
      setCurrentConversationId(null);
      setCurrentConversation(null);
    } catch (error) {
      console.error('Failed to delete all conversations:', error);
    }
  };

  const toggleModelSelection = (model) => {
    setSelectedModels((prev) =>
      prev.includes(model)
        ? prev.filter((m) => m !== model)
        : [...prev, model]
    );
  };

  const resetSelectedModels = () => {
    setSelectedModels(availableModels);
  };

  const notifyJobComplete = (titleText, bodyText) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const show = () => {
      // Avoid noisy notifications when the tab is active.
      if (document.hasFocus()) return;
      try {
        new Notification(titleText, { body: bodyText, icon: logoUrl });
      } catch (e) {
        console.warn('Notification failed:', e);
      }
    };
    if (Notification.permission === 'granted') {
      show();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') show();
      });
    }
  };

  const handleSendMessage = async (content) => {
    if (!currentConversationId) return;
    if (!selectedModels || selectedModels.length === 0) return;

    setIsLoading(true);
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
      }));

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        scrapedLinks: null,
        loading: {
          scraping: false,
          stage1: false,
          stage2: false,
          stage3: false,
        },
        progress: {
          stage1: { completed: [], total: [] },
          stage2: { completed: [], total: [] },
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
      }));

      // Send message with streaming
      await api.sendMessageStream(
        currentConversationId,
        content,
        selectedModels,
        chairmanModel,
        language,
        (eventType, event) => {
        switch (eventType) {
          case 'scraping_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.scraping = true;
              return { ...prev, messages };
            });
            break;

          case 'scraping_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.scraping = false;
              lastMsg.scrapedLinks = event.data?.links || [];
              return { ...prev, messages };
            });
            break;

          case 'scraping_error':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.scraping = false;
              return { ...prev, messages };
            });
            break;

          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              lastMsg.progress.stage1.total = event.data?.models || [];
              lastMsg.progress.stage1.completed = [];
              return { ...prev, messages };
            });
            break;
          
          case 'stage1_model_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (!lastMsg.progress.stage1.completed.includes(event.data.model)) {
                lastMsg.progress.stage1.completed = [...lastMsg.progress.stage1.completed, event.data.model];
              }
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              lastMsg.progress.stage2.total = event.data?.models || [];
              lastMsg.progress.stage2.completed = [];
              return { ...prev, messages };
            });
            break;

          case 'stage2_model_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (!lastMsg.progress.stage2.completed.includes(event.data.model)) {
                lastMsg.progress.stage2.completed = [...lastMsg.progress.stage2.completed, event.data.model];
              }
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Reload conversations to get updated title
            loadConversations();
            break;

          case 'complete':
            // Stream complete, reload conversations list
            loadConversations();
            setIsLoading(false);
            notifyJobComplete(
              t('jobFinishedTitle'),
              t('jobFinishedBody')
            );
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setIsLoading(false);
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => ({
        ...prev,
        messages: prev.messages.slice(0, -2),
      }));
      setIsLoading(false);
    }
  };

  // Show loading state while checking auth
  if (!authChecked) {
    return (
      <div className={`app ${theme}`}>
        <div className="login-container">
          <div className="login-card" style={{ textAlign: 'center' }}>
            <p>{t('checkingAuth')}</p>
          </div>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated and not IP-bypassed
  if (!user && !ipBypassed) {
    return (
      <div className={`app ${theme}`}>
        <LoginInterface onLogin={handleLogin} t={t} />
      </div>
    );
  }

  return (
    <div className={`app ${theme} ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <button 
        className="mobile-menu-btn"
        onClick={toggleSidebar}
        aria-label="Toggle menu"
      >
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
      </button>
      {sidebarOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={(id) => {
          handleSelectConversation(id);
          closeSidebar();
        }}
        onNewConversation={() => {
          handleNewConversation();
          closeSidebar();
        }}
        onDeleteConversation={handleDeleteConversation}
        onDeleteAllConversations={handleDeleteAllConversations}
        isOpen={sidebarOpen}
        theme={theme}
        onToggleTheme={toggleTheme}
        language={language}
        onLanguageChange={setLanguageSafe}
        t={t}
        user={user}
        onLogout={handleLogout}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        availableModels={availableModels}
        selectedModels={selectedModels}
        onToggleModel={toggleModelSelection}
        onResetModels={resetSelectedModels}
        chairmanModel={chairmanModel}
        onSelectChairman={setChairmanModel}
        modelsLoaded={modelsLoaded}
        t={t}
      />
    </div>
  );
}

export default App;
