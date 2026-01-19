/**
 * API client for the LLM Council backend.
 */

// Allow overriding the backend URL via Vite env (VITE_API_BASE).
// Default: same origin + Vite base path (supports hosting under a subpath, e.g. /council)
const stripTrailingSlash = (url) => url.replace(/\/+$/, '');
const basePath = import.meta.env.BASE_URL || '/';
const defaultApiBase =
  typeof window !== 'undefined'
    ? stripTrailingSlash(`${window.location.origin}${basePath}`)
    : 'http://localhost:8001';

const resolveApiBase = () => {
  const envApiBase = import.meta.env.VITE_API_BASE;
  if (!envApiBase) {
    return defaultApiBase;
  }

  if (envApiBase.startsWith('http://') || envApiBase.startsWith('https://')) {
    return stripTrailingSlash(envApiBase);
  }

  if (typeof window === 'undefined') {
    return stripTrailingSlash(envApiBase);
  }

  const normalized = envApiBase.startsWith('/') ? envApiBase : `/${envApiBase}`;
  return stripTrailingSlash(`${window.location.origin}${normalized}`);
};

const API_BASE = resolveApiBase();
const AUTH_TOKEN_KEY = 'councilAuthToken';

function getAuthToken() {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setAuthToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}

function withAuth(headers = {}) {
  const token = getAuthToken();
  if (token) {
    return {
      ...headers,
      Authorization: `Bearer ${token}`,
    };
  }
  return headers;
}

export const api = {
  /**
   * Login with email and password.
   */
  async login(email, password) {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Invalid credentials');
    }
    const data = await response.json();
    setAuthToken(data.access_token);
    return data;
  },

  /**
   * Logout and clear auth token.
   */
  logout() {
    setAuthToken(null);
  },

  /**
   * Get current authentication status.
   */
  async getMe() {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: withAuth(),
    });
    if (!response.ok) {
      throw new Error('Failed to get auth status');
    }
    return response.json();
  },

  /**
   * List available council and chairman models.
   */
  async listModels() {
    const response = await fetch(`${API_BASE}/api/models`);
    if (!response.ok) {
      throw new Error('Failed to list models');
    }
    return response.json();
  },

  /**
   * Get available personalization templates.
   */
  async getPersonalizationTemplates() {
    const response = await fetch(`${API_BASE}/api/personalization-templates`);
    if (!response.ok) {
      throw new Error('Failed to get personalization templates');
    }
    return response.json();
  },

  /**
   * Get user's personal prompt settings.
   */
  async getPersonalPrompt() {
    const response = await fetch(`${API_BASE}/api/user/personal-prompt`, {
      headers: withAuth(),
    });
    if (!response.ok) {
      throw new Error('Failed to get personal prompt');
    }
    return response.json();
  },

  /**
   * Update user's personal prompt settings.
   */
  async setPersonalPrompt(personalPrompt, templateId = 'custom') {
    const response = await fetch(`${API_BASE}/api/user/personal-prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withAuth(),
      },
      body: JSON.stringify({
        personal_prompt: personalPrompt,
        template_id: templateId,
      }),
    });
    if (!response.ok) {
      throw new Error('Failed to update personal prompt');
    }
    return response.json();
  },

  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      headers: withAuth(),
    });
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...withAuth(),
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        headers: withAuth(),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Delete a specific conversation.
   */
  async deleteConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`,
      {
        method: 'DELETE',
        headers: withAuth(),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to delete conversation');
    }
    return response.json();
  },

  /**
   * Delete all conversations.
   */
  async deleteAllConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'DELETE',
      headers: withAuth(),
    });
    if (!response.ok) {
      throw new Error('Failed to delete conversations');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content, models, chairmanModel, language) {
    const payload = { content, language };
    if (models && models.length > 0) {
      payload.models = models;
    }
    if (chairmanModel) {
      payload.chairman_model = chairmanModel;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...withAuth(),
        },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {string[]} models - Optional list of council models
   * @param {string} chairmanModel - Optional chairman override
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, models, chairmanModel, language, onEvent) {
    const payload = { content, language };
    if (models && models.length > 0) {
      payload.models = models;
    }
    if (chairmanModel) {
      payload.chairman_model = chairmanModel;
    }

    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...withAuth(),
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (!data) continue;
            try {
              const event = JSON.parse(data);
              onEvent(event.type, event);
            } catch (e) {
              console.error('Failed to parse SSE event:', e, 'Data:', data.substring(0, 200));
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data) {
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse final SSE event:', e);
          }
        }
      }
    } catch (streamError) {
      // Handle stream read errors (e.g., HTTP2 protocol errors, network issues)
      console.error('Stream read error:', streamError);
      onEvent('error', { 
        type: 'error', 
        message: `Connection interrupted: ${streamError.message || 'network error'}` 
      });
      throw streamError;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader already released
      }
    }
  },
};
