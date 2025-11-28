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
const SESSION_STORAGE_KEY = 'councilSessionId';
const SESSION_HEADER = 'X-Session-Id';

function getSessionId() {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    window.localStorage.setItem(SESSION_STORAGE_KEY, newId);
    return newId;
  } catch (e) {
    // Fall back to a random string if localStorage is unavailable
    return Math.random().toString(36).slice(2);
  }
}

function withSession(headers = {}) {
  return {
    ...headers,
    [SESSION_HEADER]: getSessionId(),
  };
}

export const api = {
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
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      headers: withSession(),
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
        ...withSession(),
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
        headers: withSession(),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
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
          ...withSession(),
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
          ...withSession(),
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
