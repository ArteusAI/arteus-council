import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import LanguageSwitcher from './components/LanguageSwitcher';
import { api } from './api';
import { translate, supportedLanguages } from './i18n';
import './App.css';

const normalizeLang = (code) => {
  if (!code) return 'en';
  const lower = code.toLowerCase();
  if (lower.startsWith('ru')) return 'ru';
  if (lower.startsWith('el') || lower.startsWith('gr')) return 'el';
  return 'en';
};

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const logoUrl = 'https://framerusercontent.com/images/G4MFpJVGo4QKdInsGAegy907Em4.png';
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    try {
      const savedLang = window.sessionStorage.getItem('arteusLang');
      if (savedLang) {
        setLanguage(normalizeLang(savedLang));
        return;
      }
      const navLang = navigator.language || (navigator.languages || [])[0];
      const detected = normalizeLang(navLang);
      setLanguage(detected);
      window.sessionStorage.setItem('arteusLang', detected);
    } catch (e) {
      console.warn('Language load failed', e);
    }
  }, []);

  const setLanguageSafe = (code) => {
    const normalized = normalizeLang(code);
    setLanguage(normalized);
    try {
      window.sessionStorage.setItem('arteusLang', normalized);
    } catch (e) {
      console.warn('Language save failed', e);
    }
  };

  const t = (key) => translate(language, key);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
    loadModels();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
    }
  }, [currentConversationId]);

  const loadConversations = async () => {
    try {
      const convs = await api.listConversations();
      setConversations(convs);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  };

  const loadModels = async () => {
    try {
      const data = await api.listModels();
      const councilList = data.council_models || [];
      setAvailableModels(councilList);
      const defaultPreferred =
        data.default_preferred_models || [
          'openai/gpt-5.1',
          'anthropic/claude-sonnet-4.5',
          'google/gemini-3-pro-preview',
        ];
      const defaultSelection = councilList.filter((m) =>
        defaultPreferred.includes(m)
      );
      setSelectedModels(
        defaultSelection.length ? defaultSelection : councilList.slice(0, 3)
      );
      const chairmanCandidate =
        data.chairman_model ||
        defaultSelection[0] ||
        councilList[0] ||
        '';
      setChairmanModel(chairmanCandidate);
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setModelsLoaded(true);
    }
  };

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
        loading: {
          stage1: false,
          stage2: false,
          stage3: false,
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
          case 'stage1_start':
            setCurrentConversation((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
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

  return (
    <div className="app">
      <LanguageSwitcher
        language={language}
        onChangeLanguage={setLanguageSafe}
        languages={supportedLanguages}
      />
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        t={t}
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
