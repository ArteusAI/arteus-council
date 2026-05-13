import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import LoginInterface from './components/LoginInterface';
import LeadsLoginInterface from './components/LeadsLoginInterface';
import ConferenceModeScreen from './components/ConferenceModeScreen';
import { api } from './api';
import { translate } from './i18n';
import { isAgoraModel, setModelAliases as setGlobalModelAliases } from './utils/modelDisplay';
import { safeStorage } from './utils/safeStorage';
import './App.css';

const normalizeLang = (code, { disableRussian = false } = {}) => {
  if (!code) return 'en';
  const lower = code.toLowerCase();
  if (lower.startsWith('ru')) return disableRussian ? 'en' : 'ru';
  if (lower.startsWith('el') || lower.startsWith('gr')) return 'el';
  return 'en';
};

function App() {
  const [configLoaded, setConfigLoaded] = useState(false);
  const [conferenceMode, setConferenceMode] = useState(false);
  const [leadsMode, setLeadsMode] = useState(false);
  const [fixedIdentityId, setFixedIdentityId] = useState(null);
  const [disableRussian, setDisableRussian] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [leadUser, setLeadUser] = useState(null);
  const [ipBypassed, setIpBypassed] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(
    () => safeStorage.get('arteusCurrentConversationId') || null
  );
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);
  const [showConversationLoadingSpinner, setShowConversationLoadingSpinner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [identityTemplates, setIdentityTemplates] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [enableSecondRound, setEnableSecondRound] = useState(
    () => safeStorage.get('arteusEnableSecondRound') === 'true'
  );
  const [baseSystemPrompt, setBaseSystemPrompt] = useState('');
  const [baseSystemPromptId, setBaseSystemPromptId] = useState('custom');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const logoUrl = 'https://framerusercontent.com/images/G4MFpJVGo4QKdInsGAegy907Em4.png';
  const [language, setLanguage] = useState(
    () => safeStorage.get('arteusLang') || 'en'
  );
  const [theme, setTheme] = useState(
    () => safeStorage.get('arteusTheme') || 'dark'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showBasePromptSettings, setShowBasePromptSettings] = useState(false);
  const [utmTelegram, setUtmTelegram] = useState('');
  const abortControllerRef = useRef(null);
  const activeStreamConversationRef = useRef(null);
  const inProgressConversationRef = useRef(null);
  const conversationLoadRequestRef = useRef(0);
  const conversationLoadDelayRef = useRef(null);
  const currentConversationIdRef = useRef(currentConversationId);
  const leadsModeRef = useRef(false);
  const leadUserRef = useRef(null);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    console.log('[leadsMode] state changed to:', leadsMode);
    leadsModeRef.current = leadsMode;
  }, [leadsMode]);

  useEffect(() => {
    console.log('[leadUser] state changed to:', leadUser ? { session_id: leadUser.session_id, email: leadUser.email } : null);
    leadUserRef.current = leadUser;
  }, [leadUser]);

  const clearConversationLoadingDelay = useCallback(() => {
    if (conversationLoadDelayRef.current) {
      window.clearTimeout(conversationLoadDelayRef.current);
      conversationLoadDelayRef.current = null;
    }
  }, []);

  const stopConversationLoading = useCallback(() => {
    clearConversationLoadingDelay();
    setIsConversationLoading(false);
    setShowConversationLoadingSpinner(false);
  }, [clearConversationLoadingDelay]);

  useEffect(() => () => clearConversationLoadingDelay(), [clearConversationLoadingDelay]);

  // Check for mobile device on mount
  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
                    || window.innerWidth < 768;
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Parse UTM parameters for pre-filled login
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const telegram = params.get('telegram') || params.get('tg') || params.get('utm_telegram');
    if (telegram) {
      setUtmTelegram(telegram);
    }
  }, []);

  const abortCurrentRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeStreamConversationRef.current = null;
    inProgressConversationRef.current = null;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    safeStorage.set('arteusTheme', theme);
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
    if (!configLoaded) return;
    const savedLang = safeStorage.get('arteusLang');
    if (savedLang) {
      const normalized = normalizeLang(savedLang, { disableRussian });
      setLanguage(normalized);
      if (normalized !== savedLang) {
        safeStorage.set('arteusLang', normalized);
      }
      return;
    }
    const defaultLang = disableRussian ? 'en' : 'ru';
    setLanguage(defaultLang);
    safeStorage.set('arteusLang', defaultLang);
  }, [configLoaded, disableRussian]);

  const setLanguageSafe = (code) => {
    const normalized = normalizeLang(code, { disableRussian });
    setLanguage(normalized);
    safeStorage.set('arteusLang', normalized);
  };

  const t = useCallback((key) => translate(language, key), [language]);

  // Check config and authentication on mount
  useEffect(() => {
    const initApp = async () => {
      // First, load config to determine mode
      try {
        const config = await api.getConfig();
        console.log('[config] loaded:', config);
        setConferenceMode(config.END_CONFERENCE_MODE || false);
        setLeadsMode(config.leads_mode || false);
        setFixedIdentityId(config.fixed_identity_id || null);
        setDisableRussian(Boolean(config.disable_russian_language));
        
        // Log conference mode activation
        if (config.END_CONFERENCE_MODE) {
          if (config.conference_mode_reason === 'api_limits_exhausted') {
            console.warn('⚠️ HASTA LA VISTA!');
          } else if (config.conference_mode_reason === 'manual') {
            console.info('ℹ️ Conference mode activated manually');
          } else {
            console.info('ℹ️ Conference mode activated');
          }
        }
      } catch (error) {
        console.warn('Config load failed, assuming normal mode:', error);
        setConferenceMode(false);
        setLeadsMode(false);
      } finally {
        setConfigLoaded(true);
      }
    };
    initApp();
  }, []);

  // Check authentication after config is loaded
  useEffect(() => {
    if (!configLoaded) return;

    const checkAuth = async () => {
      try {
        if (leadsMode) {
          // In leads mode, check for existing lead session
          const data = await api.getLeadMe();
          if (data.authenticated) {
            setLeadUser({
              session_id: data.session_id,
              email: data.email,
              telegram: data.telegram,
            });
          }
        } else {
          // Normal mode
          const data = await api.getMe();
          setIpBypassed(data.ip_bypassed || false);
          if (data.authenticated) {
            setUser(data.user);
          }
        }
      } catch (error) {
        console.warn('Auth check failed:', error);
      } finally {
        setAuthChecked(true);
      }
    };
    checkAuth();
  }, [configLoaded, leadsMode]);

  const handleLogin = async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
  };

  const handleLeadsRegister = async (email, telegram, linkedin) => {
    const data = await api.registerLead(email, telegram, linkedin);
    setLeadUser({
      session_id: data.session_id,
      email: data.email,
      telegram: data.telegram,
      linkedin: data.linkedin,
    });
  };

  const handleLogout = useCallback(() => {
    api.logout();
    setUser(null);
    setLeadUser(null);
    setConversations([]);
    setCurrentConversationId(null);
    setCurrentConversation(null);
  }, []);

  // Load conversations when authenticated
  useEffect(() => {
    if (!authChecked) return;
    if (leadsMode) {
      if (!leadUser) return;
    } else {
      if (!user && !ipBypassed) return;
    }
    loadConversations();
    loadModels();
  }, [authChecked, user, leadUser, ipBypassed, leadsMode]);

  const loadConversations = useCallback(async () => {
    try {
      const isLeads = Boolean(leadsModeRef.current || leadUserRef.current);
      console.log('[loadConversations] isLeads=', isLeads, 'leadsModeRef=', leadsModeRef.current, 'leadUser=', !!leadUserRef.current);
      const convs = isLeads
        ? await api.listLeadsConversations()
        : await api.listConversations();
      console.log('[loadConversations] received', convs.length, 'conversations');
      setConversations(convs);

      // Validate currentConversationId if it exists
      if (currentConversationId && !convs.find(c => c.id === currentConversationId)) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }

      // Auto-select or create conversation
      if (convs.length === 0) {
        // No conversations - create first one automatically
        const newConv = isLeads
          ? await api.createLeadsConversation()
          : await api.createConversation();
        setConversations([{ id: newConv.id, created_at: newConv.created_at, message_count: 0 }]);
        setCurrentConversationId(newConv.id);
      } else if (!currentConversationId) {
        // Has conversations but none selected - select the most recent (first in list)
        setCurrentConversationId(convs[0].id);
      } else if (convs.find(c => c.id === currentConversationId)) {
        // Reload only if no active stream — otherwise the in-memory state
        // (with stage1/2/3 progress) would be overwritten by a partial server snapshot.
        if (activeStreamConversationRef.current !== currentConversationId) {
          loadConversation(currentConversationId);
        }
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
    }
  }, [currentConversationId, leadsMode]);

  const loadModels = useCallback(async () => {
    try {
      // In leads mode, skip council settings (they're fixed)
      const promises = [
        api.listModels(),
        api.getCouncilIdentityTemplates().catch(e => {
          console.warn('Failed to load identity templates:', e);
          return { templates: [] };
        })
      ];

      // Load council settings (different endpoints for leads vs normal mode)
      promises.push(
        leadsMode
          ? api.getLeadsCouncilSettings().catch(e => {
              console.warn('Failed to load leads council settings:', e);
              return { personal_prompt: '', template_id: 'default' };
            })
          : api.getCouncilSettings().catch(e => {
              console.warn('Failed to load council settings:', e);
              return { personal_prompt: '', template_id: 'default', base_system_prompt: '', base_system_prompt_id: 'arteus' };
            })
      );

      const results = await Promise.all(promises);
      const data = results[0];
      const templatesData = results[1];
      const settings = results[2];

      const councilList = data.council_models || [];
      const templates = templatesData.templates || [];
      const aliases = data.model_aliases || {};
      setAvailableModels(councilList);
      setIdentityTemplates(templates);
      setModelAliases(aliases);
      setGlobalModelAliases(aliases);
      
      let promptText = settings.base_system_prompt || '';
      const promptId = settings.base_system_prompt_id || 'custom';
      
      // Fallback: if text is empty but template is known, fill from templates
      if (!promptText && promptId !== 'custom') {
        const template = templates.find(t => t.id === promptId);
        if (template) {
          promptText = template.prompt;
        }
      }
      
      setBaseSystemPrompt(promptText);
      setBaseSystemPromptId(promptId);

      let savedModels = null;
      let savedChairman = null;
      try {
        const savedModelsStr = safeStorage.get('arteusSelectedModels');
        const savedChairmanStr = safeStorage.get('arteusChairmanModel');
        if (savedModelsStr) {
          savedModels = JSON.parse(savedModelsStr);
          savedModels = savedModels.filter((m) =>
            councilList.includes(m) && !isAgoraModel(m)
          );
          if (savedModels.length === 0) savedModels = null;
        }
        if (
          savedChairmanStr &&
          councilList.includes(savedChairmanStr) &&
          !isAgoraModel(savedChairmanStr)
        ) {
          savedChairman = savedChairmanStr;
        }
      } catch (e) {
        console.warn('Failed to load saved models', e);
      }

      // Get default preferred models
      const defaultPreferred = data.default_preferred_models || [];
      const defaultSelection = councilList.filter((m) =>
        defaultPreferred.includes(m)
      );

      if (savedModels) {
        setSelectedModels(savedModels);
      } else {
        setSelectedModels(defaultSelection.length > 0 ? defaultSelection : councilList);
      }

      if (savedChairman) {
        setChairmanModel(savedChairman);
      } else {
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
  }, []);

  useEffect(() => {
    if (!conversations.some((conversation) => conversation.job_status)) return;
    const intervalId = window.setInterval(() => {
      loadConversations();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [conversations, loadConversations]);

  const loadConversation = useCallback(async (id, options = {}) => {
    const { showOverlay = true } = options;
    const requestId = conversationLoadRequestRef.current + 1;
    conversationLoadRequestRef.current = requestId;
    clearConversationLoadingDelay();

    if (showOverlay) {
      setIsConversationLoading(true);
      setShowConversationLoadingSpinner(false);
      conversationLoadDelayRef.current = window.setTimeout(() => {
        if (conversationLoadRequestRef.current === requestId) {
          setShowConversationLoadingSpinner(true);
        }
      }, 1000);
    }

    try {
      const useLeads = Boolean(leadsModeRef.current || leadUserRef.current);
      console.log('[loadConversation] id=', id, 'useLeads=', useLeads, 'leadsModeRef=', leadsModeRef.current, 'leadUser=', !!leadUserRef.current);
      let conv;
      try {
        conv = useLeads
          ? await api.getLeadsConversation(id)
          : await api.getConversation(id);
        console.log('[loadConversation] OK primary endpoint, messages=', conv?.messages?.length);
      } catch (primaryError) {
        console.warn('[loadConversation] primary failed, trying fallback. Error:', primaryError);
        conv = useLeads
          ? await api.getConversation(id)
          : await api.getLeadsConversation(id);
        console.log('[loadConversation] OK fallback endpoint, messages=', conv?.messages?.length);
      }
      if (conversationLoadRequestRef.current === requestId) {
        setCurrentConversation(conv);
      }
    } catch (error) {
      if (conversationLoadRequestRef.current === requestId) {
        console.error('Failed to load conversation:', error);
      }
    } finally {
      if (conversationLoadRequestRef.current === requestId) {
        stopConversationLoading();
      }
    }
  }, [clearConversationLoadingDelay, stopConversationLoading, leadsMode]);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      // If there's an in-progress conversation state for this ID, restore it
      if (inProgressConversationRef.current && 
          inProgressConversationRef.current.id === currentConversationId) {
        conversationLoadRequestRef.current += 1;
        stopConversationLoading();
        setCurrentConversation(inProgressConversationRef.current);
      } else {
        loadConversation(currentConversationId);
      }
    } else {
      conversationLoadRequestRef.current += 1;
      stopConversationLoading();
    }
  }, [currentConversationId, loadConversation, stopConversationLoading]);

  useEffect(() => {
    if (currentConversationId) {
      safeStorage.set('arteusCurrentConversationId', currentConversationId);
    } else {
      safeStorage.remove('arteusCurrentConversationId');
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (!modelsLoaded) return;
    const persistentModels = selectedModels.filter((model) => !isAgoraModel(model));
    safeStorage.set('arteusSelectedModels', JSON.stringify(persistentModels));
  }, [selectedModels, modelsLoaded]);

  useEffect(() => {
    if (!modelsLoaded || !chairmanModel) return;
    if (isAgoraModel(chairmanModel)) {
      safeStorage.remove('arteusChairmanModel');
      return;
    }
    safeStorage.set('arteusChairmanModel', chairmanModel);
  }, [chairmanModel, modelsLoaded]);

  useEffect(() => {
    safeStorage.set('arteusEnableSecondRound', enableSecondRound ? 'true' : 'false');
  }, [enableSecondRound]);

  const handleNewConversation = async () => {
    try {
      const newConv = leadsMode
        ? await api.createLeadsConversation()
        : await api.createConversation();
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
    // Save current in-progress state if there's an active stream for the current conversation
    if (activeStreamConversationRef.current && currentConversation && 
        currentConversation.id === activeStreamConversationRef.current) {
      inProgressConversationRef.current = currentConversation;
    }
    
    setCurrentConversationId(id);
    // Update loading state based on whether there's an active stream for this conversation
    setIsLoading(activeStreamConversationRef.current === id);
  };

  const handleDeleteConversation = async (id) => {
    try {
      // Detach the local observer; the backend delete cancels the job.
      if (activeStreamConversationRef.current === id) {
        abortCurrentRequest();
      }
      if (currentConversationId === id) {
        setIsLoading(false);
      }
      if (leadsMode) {
        await api.deleteLeadsConversation(id);
      } else {
        await api.deleteConversation(id);
      }
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
      // Abort any ongoing request
      abortCurrentRequest();
      setIsLoading(false);
      if (leadsMode) {
        await api.deleteAllLeadsConversations();
      } else {
        await api.deleteAllConversations();
      }
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

  const handleUpdateBaseSystemPrompt = async (newPrompt, newPromptId = 'custom') => {
    setBaseSystemPrompt(newPrompt);
    setBaseSystemPromptId(newPromptId);
    try {
      // Get current settings first to preserve personal prompt
      const settings = await api.getCouncilSettings();
      await api.setCouncilSettings(
        settings.personal_prompt,
        settings.template_id,
        newPrompt,
        newPromptId
      );
    } catch (error) {
      console.error('Failed to save base system prompt:', error);
    }
  };

  const ensureAssistantRuntimeState = useCallback((message) => {
    message.metadata = {
      second_round_enabled: false,
      second_round_status: 'skipped',
      round2_finalists: [],
      round2: null,
      ...(message.metadata || {}),
    };
    const loading = message.loading || {};
    message.loading = {
      scraping: false,
      stage1: false,
      stage2: false,
      round2Stage1: false,
      round2Stage2: false,
      stage3: false,
      ...loading,
    };
    const progress = message.progress || {};
    message.progress = {
      stage1: progress.stage1 || { completed: [], total: [] },
      stage2: progress.stage2 || { completed: [], total: [] },
      round2Stage1: progress.round2Stage1 || { completed: [], total: [] },
      round2Stage2: progress.round2Stage2 || { completed: [], total: [] },
    };
    if (!message.rounds) {
      message.rounds = [];
    }
    return message;
  }, []);

  const setConversationJobStatus = useCallback((conversationId, status, progress = null, stage = null) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              job_status: status,
              job_progress: status
                ? progress ?? conversation.job_progress ?? 3
                : null,
              job_stage: status ? stage ?? conversation.job_stage ?? null : null,
            }
          : conversation
      )
    );
  }, []);

  const mergeJobSnapshotIntoConversation = useCallback((conversation, snapshot) => {
    if (!conversation || !snapshot?.assistant_message) return conversation;
    const assistantMessage = ensureAssistantRuntimeState(
      JSON.parse(JSON.stringify(snapshot.assistant_message))
    );
    const messages = [...(conversation.messages || [])];
    if (messages.length === 0 && snapshot.user_message) {
      messages.push({ ...snapshot.user_message });
    }
    const lastIndex = messages.length - 1;
    if (messages[lastIndex]?.role === 'assistant') {
      messages[lastIndex] = assistantMessage;
    } else {
      messages.push(assistantMessage);
    }
    return { ...conversation, messages };
  }, [ensureAssistantRuntimeState]);

  const applyJobSnapshot = useCallback((conversationId, snapshot) => {
    if (!snapshot) return;
    const isActive = Boolean(snapshot.active);
    setConversationJobStatus(
      conversationId,
      isActive ? snapshot.status : null,
      snapshot.progress,
      snapshot.stage
    );

    if (currentConversationIdRef.current === conversationId) {
      setIsLoading(isActive);
    }

    if (!snapshot.assistant_message) return;

    if (inProgressConversationRef.current?.id === conversationId) {
      inProgressConversationRef.current = mergeJobSnapshotIntoConversation(
        inProgressConversationRef.current,
        snapshot
      );
    }

    setCurrentConversation((prev) => {
      if (prev?.id !== conversationId) return prev;
      const updated = mergeJobSnapshotIntoConversation(prev, snapshot);
      inProgressConversationRef.current = updated;
      return updated;
    });
  }, [mergeJobSnapshotIntoConversation, setConversationJobStatus]);

  const handleStreamComplete = useCallback((conversationId) => {
    setConversationJobStatus(conversationId, null);
    if (activeStreamConversationRef.current === conversationId) {
      activeStreamConversationRef.current = null;
    }
    if (inProgressConversationRef.current?.id === conversationId) {
      inProgressConversationRef.current = null;
    }
    loadConversations();
    if (currentConversationIdRef.current === conversationId) {
      loadConversation(conversationId, { showOverlay: false });
      setIsLoading(false);
    }
    notifyJobComplete(
      t('jobFinishedTitle'),
      t('jobFinishedBody')
    );
  }, [loadConversation, loadConversations, setConversationJobStatus, t]);

  const handleStreamFailure = useCallback((conversationId, shouldReload = false) => {
    setConversationJobStatus(conversationId, null);
    if (activeStreamConversationRef.current === conversationId) {
      activeStreamConversationRef.current = null;
    }
    if (inProgressConversationRef.current?.id === conversationId) {
      inProgressConversationRef.current = null;
    }
    if (currentConversationIdRef.current === conversationId) {
      if (shouldReload) {
        loadConversation(conversationId, { showOverlay: false });
      }
      setIsLoading(false);
    }
  }, [loadConversation, setConversationJobStatus]);

  const connectToJobStream = useCallback((conversationId) => {
    if (
      activeStreamConversationRef.current === conversationId &&
      abortControllerRef.current
    ) {
      return;
    }

    abortCurrentRequest();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    activeStreamConversationRef.current = conversationId;
    if (currentConversationIdRef.current === conversationId) {
      setIsLoading(true);
    }

    const attachMethod = leadsModeRef.current
      ? api.attachLeadsMessageStream.bind(api)
      : api.attachMessageStream.bind(api);

    attachMethod(
      conversationId,
      (eventType, event) => {
        if (eventType === 'job_snapshot') {
          applyJobSnapshot(conversationId, event.data);
          return;
        }
        if (eventType === 'complete') {
          handleStreamComplete(conversationId);
          return;
        }
        if (eventType === 'error') {
          console.error('Stream error:', event.message);
          handleStreamFailure(conversationId, true);
        }
      },
      abortController.signal
    ).catch((error) => {
      if (error.name === 'AbortError') return;
      console.error('Failed to attach to job stream:', error);
      handleStreamFailure(conversationId, false);
    }).finally(() => {
      if (activeStreamConversationRef.current === conversationId) {
        activeStreamConversationRef.current = null;
      }
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    });
  }, [
    abortCurrentRequest,
    applyJobSnapshot,
    handleStreamComplete,
    handleStreamFailure,
  ]);

  const refreshConversationJob = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      const fetchJob = leadsModeRef.current
        ? api.getLeadsConversationJob.bind(api)
        : api.getConversationJob.bind(api);
      const snapshot = await fetchJob(conversationId);
      applyJobSnapshot(conversationId, snapshot);
      if (snapshot.active) {
        connectToJobStream(conversationId);
      } else if (currentConversationIdRef.current === conversationId) {
        setIsLoading(false);
      }
    } catch (error) {
      console.warn('Failed to refresh conversation job:', error);
    }
  }, [applyJobSnapshot, connectToJobStream]);

  useEffect(() => {
    if (!currentConversationId || currentConversation?.id !== currentConversationId) {
      return;
    }
    refreshConversationJob(currentConversationId);
  }, [currentConversation?.id, currentConversationId, refreshConversationJob]);

  // iOS Safari may freeze timers and the SSE socket when the tab goes into the
  // background. Once the user comes back, re-sync the in-memory job state and
  // re-attach to the stream so any in-flight council generation keeps showing
  // progress / final results.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const conversationId = currentConversationIdRef.current;
      if (!conversationId) return;
      refreshConversationJob(conversationId);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    window.addEventListener('pageshow', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
      window.removeEventListener('pageshow', handleVisibility);
    };
  }, [refreshConversationJob]);

  const handleSendMessage = async (content, options = {}) => {
    const { continueLastAssistantRound = false } = options;
    if (!currentConversationId) return;
    if (!selectedModels || selectedModels.length === 0) return;
    if (!content?.trim()) return;

    if (continueLastAssistantRound) {
      const currentMessages = currentConversation?.messages || [];
      const lastMessage = currentMessages[currentMessages.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') return;
      if (lastMessage.metadata?.second_round_enabled) return;
    }

    // Abort any previous request
    abortCurrentRequest();

    // Create new AbortController for this request
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    // Track which conversation this stream belongs to
    const streamConversationId = currentConversationId;
    activeStreamConversationRef.current = streamConversationId;
    setConversationJobStatus(streamConversationId, 'running');

    setIsLoading(true);
    try {
      if (continueLastAssistantRound) {
        setCurrentConversation((prev) => {
          if (!prev?.messages?.length) return prev;
          const messages = [...prev.messages];
          const lastMsg = ensureAssistantRuntimeState(messages[messages.length - 1]);
          lastMsg.stage3 = null;
          lastMsg.metadata = {
            ...lastMsg.metadata,
            second_round_enabled: false,
            second_round_status: 'skipped',
            round2_finalists: [],
            round2: null,
          };
          lastMsg.rounds = (lastMsg.rounds || []).filter((round) => round.round === 1);
          lastMsg.loading.round2Stage1 = true;
          lastMsg.loading.round2Stage2 = false;
          lastMsg.loading.stage3 = false;
          lastMsg.progress.round2Stage1 = { completed: [], total: [] };
          lastMsg.progress.round2Stage2 = { completed: [], total: [] };
          const updated = { ...prev, messages };
          inProgressConversationRef.current = updated;
          return updated;
        });
      } else {
        // Optimistically add user message to UI
        const userMessage = { role: 'user', content };

        // Create a partial assistant message that will be updated progressively
        const assistantMessage = {
          role: 'assistant',
          stage1: null,
          stage2: null,
          stage3: null,
          metadata: {
            second_round_enabled: enableSecondRound,
            second_round_status: 'skipped',
            round2_finalists: [],
            round2: null,
          },
          rounds: [],
          scrapedLinks: null,
          loading: {
            scraping: false,
            stage1: false,
            stage2: false,
            round2Stage1: false,
            round2Stage2: false,
            stage3: false,
          },
          progress: {
            stage1: { completed: [], total: [] },
            stage2: { completed: [], total: [] },
            round2Stage1: { completed: [], total: [] },
            round2Stage2: { completed: [], total: [] },
          },
        };

        // Add both messages and initialize the in-progress state
        setCurrentConversation((prev) => {
          const updated = {
            ...prev,
            messages: [...prev.messages, userMessage, assistantMessage],
          };
          inProgressConversationRef.current = updated;
          return updated;
        });
      }

      // Helper to update conversation state
      const updateConversationState = (updater) => {
        // Update in-progress ref if we're not viewing this conversation
        if (inProgressConversationRef.current?.id === streamConversationId) {
          inProgressConversationRef.current = updater(inProgressConversationRef.current);
        }
        
        setCurrentConversation((prev) => {
          // Only update if we're still viewing this conversation
          if (prev?.id !== streamConversationId) {
            return prev;
          }
          const updated = updater(prev);
          // Also keep the ref in sync
          inProgressConversationRef.current = updated;
          return updated;
        });
      };

      // Don't send empty custom prompt - let backend use default (only in normal mode)
      const effectiveBasePrompt = leadsMode 
        ? null  // In leads mode, backend uses fixed identity
        : ((baseSystemPromptId === 'custom' && !baseSystemPrompt.trim()) ? null : baseSystemPrompt);

      // Send message with streaming (use appropriate API based on mode)
      console.log('[handleSendMessage] leadsMode=', leadsMode, 'leadUser=', !!leadUser, '→ using', leadsMode ? 'LEADS stream' : 'NORMAL stream');
      const streamMethod = leadsMode ? api.sendLeadsMessageStream : api.sendMessageStream;
      const streamArgs = leadsMode
        ? [streamConversationId, content, selectedModels, chairmanModel, language]
        : [
            streamConversationId,
            content,
            selectedModels,
            chairmanModel,
            language,
            effectiveBasePrompt,
            enableSecondRound || continueLastAssistantRound,
            continueLastAssistantRound,
          ];

      await streamMethod(
        ...streamArgs,
        (eventType, event) => {
        switch (eventType) {
          case 'job_snapshot':
            applyJobSnapshot(streamConversationId, event.data);
            break;

          case 'scraping_start':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.scraping = true;
              return { ...prev, messages };
            });
            break;

          case 'scraping_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.scraping = false;
              lastMsg.scrapedLinks = event.data?.links || [];
              return { ...prev, messages };
            });
            break;

          case 'scraping_error':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.scraping = false;
              return { ...prev, messages };
            });
            break;

          case 'stage1_start':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage1 = true;
              lastMsg.progress.stage1.total = event.data?.models || [];
              lastMsg.progress.stage1.completed = [];
              return { ...prev, messages };
            });
            break;
          
          case 'stage1_model_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (!lastMsg.progress.stage1.completed.includes(event.data.model)) {
                lastMsg.progress.stage1.completed = [...lastMsg.progress.stage1.completed, event.data.model];
              }
              return { ...prev, messages };
            });
            break;

          case 'stage1_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage1 = event.data;
              lastMsg.loading.stage1 = false;
              return { ...prev, messages };
            });
            break;

          case 'stage2_start':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.stage2 = true;
              lastMsg.progress.stage2.total = event.data?.models || [];
              lastMsg.progress.stage2.completed = [];
              return { ...prev, messages };
            });
            break;

          case 'stage2_model_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (!lastMsg.progress.stage2.completed.includes(event.data.model)) {
                lastMsg.progress.stage2.completed = [...lastMsg.progress.stage2.completed, event.data.model];
              }
              return { ...prev, messages };
            });
            break;

          case 'stage2_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage2 = event.data;
              lastMsg.metadata = event.metadata;
              lastMsg.rounds = [
                {
                  round: 1,
                  stage1: lastMsg.stage1 || [],
                  stage2: event.data || [],
                  metadata: event.metadata || null,
                },
              ];
              lastMsg.loading.stage2 = false;
              return { ...prev, messages };
            });
            break;

          case 'round2_stage1_start':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.round2Stage1 = true;
              lastMsg.progress.round2Stage1.total = event.data?.models || [];
              lastMsg.progress.round2Stage1.completed = [];
              lastMsg.metadata = {
                ...(lastMsg.metadata || {}),
                second_round_enabled: true,
                round2_finalists: event.data?.finalists || event.data?.models || [],
              };
              return { ...prev, messages };
            });
            break;

          case 'round2_stage1_model_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (!lastMsg.progress.round2Stage1.completed.includes(event.data.model)) {
                lastMsg.progress.round2Stage1.completed = [
                  ...lastMsg.progress.round2Stage1.completed,
                  event.data.model,
                ];
              }
              return { ...prev, messages };
            });
            break;

          case 'round2_stage1_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.round2Stage1 = false;
              lastMsg.metadata = {
                ...(lastMsg.metadata || {}),
                second_round_enabled: true,
                round2_finalists: event.metadata?.finalists || lastMsg.metadata?.round2_finalists || [],
              };
              const round1 = lastMsg.rounds?.[0] || {
                round: 1,
                stage1: lastMsg.stage1 || [],
                stage2: lastMsg.stage2 || [],
                metadata: lastMsg.metadata || null,
              };
              lastMsg.rounds = [
                round1,
                {
                  round: 2,
                  stage1: event.data || [],
                  stage2: [],
                  metadata: null,
                },
              ];
              return { ...prev, messages };
            });
            break;

          case 'round2_stage2_start':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.round2Stage2 = true;
              lastMsg.progress.round2Stage2.total = event.data?.models || [];
              lastMsg.progress.round2Stage2.completed = [];
              return { ...prev, messages };
            });
            break;

          case 'round2_stage2_model_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              if (!lastMsg.progress.round2Stage2.completed.includes(event.data.model)) {
                lastMsg.progress.round2Stage2.completed = [
                  ...lastMsg.progress.round2Stage2.completed,
                  event.data.model,
                ];
              }
              return { ...prev, messages };
            });
            break;

          case 'round2_stage2_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.round2Stage2 = false;
              const round1 = lastMsg.rounds?.[0] || {
                round: 1,
                stage1: lastMsg.stage1 || [],
                stage2: lastMsg.stage2 || [],
                metadata: lastMsg.metadata || null,
              };
              const round2 = lastMsg.rounds?.[1] || {
                round: 2,
                stage1: [],
                stage2: [],
                metadata: null,
              };
              round2.stage2 = event.data || [];
              round2.metadata = event.metadata || null;
              lastMsg.rounds = [round1, round2];
              lastMsg.metadata = {
                ...(lastMsg.metadata || {}),
                second_round_enabled: true,
                round2: event.metadata || null,
              };
              return { ...prev, messages };
            });
            break;

          case 'stage3_start':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.loading.round2Stage1 = false;
              lastMsg.loading.round2Stage2 = false;
              lastMsg.loading.stage3 = true;
              return { ...prev, messages };
            });
            break;

          case 'stage3_complete':
            updateConversationState((prev) => {
              const messages = [...prev.messages];
              const lastMsg = messages[messages.length - 1];
              lastMsg.stage3 = event.data;
              if (event.metadata) {
                lastMsg.metadata = event.metadata;
              }
              if (event.rounds) {
                lastMsg.rounds = event.rounds;
              }
              lastMsg.loading.stage3 = false;
              return { ...prev, messages };
            });
            break;

          case 'title_complete':
            // Update only the title in the list to avoid overwriting in-memory stream state.
            if (event.data?.title) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === streamConversationId ? { ...c, title: event.data.title } : c
                )
              );
            }
            break;

          case 'complete':
            console.log('[stream] complete event for', streamConversationId, 'leadsModeRef=', leadsModeRef.current, 'leadUser=', !!leadUserRef.current);
            setConversationJobStatus(streamConversationId, null);
            loadConversations();
            activeStreamConversationRef.current = null;
            inProgressConversationRef.current = null;
            // Reload the conversation to get the saved state
            if (streamConversationId === currentConversationIdRef.current) {
              loadConversation(streamConversationId, { showOverlay: false });
              setIsLoading(false);
            }
            notifyJobComplete(
              t('jobFinishedTitle'),
              t('jobFinishedBody')
            );
            break;

          case 'error':
            console.error('Stream error:', event.message);
            setConversationJobStatus(streamConversationId, null);
            activeStreamConversationRef.current = null;
            inProgressConversationRef.current = null;
            if (streamConversationId === currentConversationIdRef.current) {
              if (continueLastAssistantRound) {
                loadConversation(streamConversationId, { showOverlay: false });
              }
              setIsLoading(false);
            }
            break;

          default:
            console.log('Unknown event type:', eventType);
        }
        },
        abortController.signal
      );
    } catch (error) {
      // Don't handle abort errors - they're intentional
      if (error.name === 'AbortError') {
        return;
      }
      console.error('Failed to send message:', error);
      setConversationJobStatus(streamConversationId, null);
      activeStreamConversationRef.current = null;
      inProgressConversationRef.current = null;
      if (continueLastAssistantRound) {
        if (streamConversationId === currentConversationIdRef.current) {
          loadConversation(streamConversationId, { showOverlay: false });
        }
      } else {
        // Remove optimistic messages on error
        setCurrentConversation((prev) => ({
          ...prev,
          messages: prev.messages.slice(0, -2),
        }));
      }
      setIsLoading(false);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  };

  // Show conference mode screen when enabled
  if (configLoaded && conferenceMode) {
    return (
      <div className={`app ${theme}`}>
        <ConferenceModeScreen t={t} theme={theme} />
      </div>
    );
  }

  // Show loading state while checking config or auth
  if (!configLoaded || !authChecked) {
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

  // Show login/registration screen if not authenticated
  if (leadsMode) {
    // Leads mode: show leads registration if no lead user
    if (!leadUser) {
      return (
        <div className={`app ${theme}`}>
          <LeadsLoginInterface onRegister={handleLeadsRegister} t={t} theme={theme} initialTelegram={utmTelegram} />
        </div>
      );
    }
  } else {
    // Normal mode: show login if not authenticated and not IP-bypassed
    if (!user && !ipBypassed) {
      return (
        <div className={`app ${theme}`}>
          <LoginInterface onLogin={handleLogin} t={t} theme={theme} initialTelegram={utmTelegram} />
        </div>
      );
    }
  }

  const leadsAnalysisBusy =
    leadsMode &&
    (isLoading ||
      Boolean(activeStreamConversationRef.current) ||
      conversations.some((c) => Boolean(c.job_status)));

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
        user={leadsMode ? (leadUser ? { email: leadUser.email || leadUser.telegram } : null) : user}
        onLogout={handleLogout}
        leadsMode={leadsMode}
        disableRussian={disableRussian}
        leadsAnalysisBusy={leadsAnalysisBusy}
        availableModels={availableModels}
        selectedModels={selectedModels}
        onToggleModel={toggleModelSelection}
        chairmanModel={chairmanModel}
        onSelectChairman={setChairmanModel}
        baseSystemPrompt={baseSystemPrompt}
        baseSystemPromptId={baseSystemPromptId}
        identityTemplates={identityTemplates}
        onUpdateBaseSystemPrompt={handleUpdateBaseSystemPrompt}
        modelsLoaded={modelsLoaded}
        hideIdentitySelector={leadsMode}
        showModelPicker={showModelPicker}
        onToggleModelPicker={() => setShowModelPicker((p) => !p)}
        showBasePromptSettings={showBasePromptSettings}
        onToggleBasePromptSettings={() => setShowBasePromptSettings((p) => !p)}
        onCloseBasePromptSettings={() => setShowBasePromptSettings(false)}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        onRunNextRound={(content) => handleSendMessage(content, { continueLastAssistantRound: true })}
        isLoading={isLoading}
        theme={theme}
        availableModels={availableModels}
        selectedModels={selectedModels}
        onToggleModel={toggleModelSelection}
        chairmanModel={chairmanModel}
        onSelectChairman={setChairmanModel}
        enableSecondRound={leadsMode ? false : enableSecondRound}
        onSetSecondRound={setEnableSecondRound}
        baseSystemPrompt={baseSystemPrompt}
        baseSystemPromptId={baseSystemPromptId}
        identityTemplates={identityTemplates}
        onUpdateBaseSystemPrompt={handleUpdateBaseSystemPrompt}
        modelsLoaded={modelsLoaded}
        isConversationLoading={isConversationLoading}
        showConversationLoadingSpinner={showConversationLoadingSpinner}
        language={language}
        t={t}
        hideIdentitySelector={leadsMode}
        leadsMode={leadsMode}
        leadsAnalysisBusy={leadsAnalysisBusy}
        modelAliases={modelAliases}
        showModelPicker={showModelPicker}
        onToggleModelPicker={() => setShowModelPicker((p) => !p)}
        showBasePromptSettings={showBasePromptSettings}
        onToggleBasePromptSettings={() => setShowBasePromptSettings((p) => !p)}
        onCloseBasePromptSettings={() => setShowBasePromptSettings(false)}
      />
    </div>
  );
}

export default App;
