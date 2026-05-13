/**
 * Resilient key/value storage with automatic fallbacks.
 *
 * iOS Safari (especially Private Browsing / Lockdown / ITP) and a few embedded
 * webviews may throw on `localStorage.setItem` with `QuotaExceededError` or
 * `SecurityError`, or expose a non-functional `localStorage`. The same applies
 * to `sessionStorage`. To keep the auth token, the selected conversation and
 * other state alive across an iOS tab "freeze", we transparently fall through
 * the layers: `localStorage` -> `sessionStorage` -> in-memory `Map`.
 *
 * The in-memory layer guarantees that the API never throws, but obviously
 * survives only inside the same JS context (no full page reload).
 */

const memoryStore = new Map();

const probeWebStorage = (factory) => {
  if (typeof window === 'undefined') return null;
  try {
    const candidate = factory();
    if (!candidate) return null;
    const probeKey = '__safe_storage_probe__';
    candidate.setItem(probeKey, '1');
    candidate.removeItem(probeKey);
    return candidate;
  } catch {
    return null;
  }
};

const memoryLayer = {
  getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
  setItem: (key, value) => {
    memoryStore.set(key, String(value));
  },
  removeItem: (key) => {
    memoryStore.delete(key);
  },
};

const layers = [
  probeWebStorage(() => window.localStorage),
  probeWebStorage(() => window.sessionStorage),
  memoryLayer,
].filter(Boolean);

export const safeStorage = {
  /**
   * Read a value, scanning layers top-to-bottom (persistent first).
   * Returns `null` when the key is missing everywhere.
   */
  get(key) {
    for (const layer of layers) {
      try {
        const value = layer.getItem(key);
        if (value !== null && value !== undefined) return value;
      } catch {
        // Layer became unhealthy mid-session; ignore and try the next one.
      }
    }
    return null;
  },

  /**
   * Write a value to every healthy layer so subsequent reads succeed even if
   * the persistent layer evicts (Safari) or the tab gets a soft reload.
   */
  set(key, value) {
    const stringValue = value == null ? '' : String(value);
    for (const layer of layers) {
      try {
        layer.setItem(key, stringValue);
      } catch {
        // Quota or security error on this layer; keep going.
      }
    }
  },

  /**
   * Delete a value from every layer it might exist in.
   */
  remove(key) {
    for (const layer of layers) {
      try {
        layer.removeItem(key);
      } catch {
        // Ignore.
      }
    }
  },
};

export default safeStorage;
