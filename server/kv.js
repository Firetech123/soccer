const fetch = require('node-fetch');

const CLOUDFLARE_WORKER_URL = 'https://tiny-shadow-c0c8.firetechsoftware.workers.dev/';

// In-memory fallback store if worker KV calls fail or return default response
const inMemoryStore = new Map();

/**
 * Cloudflare KV Storage Service with fallback in-memory store.
 */
class KVStore {
  static async get(key) {
    try {
      const response = await fetch(`${CLOUDFLARE_WORKER_URL}?key=${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json, text/plain' },
        timeout: 4000
      });
      if (response.ok) {
        const text = await response.text();
        // If worker returns default "Hello World!" or unparsed data, fallback to memory
        if (text && text.trim() !== 'Hello World!') {
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      }
    } catch (err) {
      console.warn(`[KVStore] Fetch GET for key "${key}" failed, using fallback memory store:`, err.message);
    }
    return inMemoryStore.get(key) || null;
  }

  static async put(key, value) {
    // Always store in local fallback cache
    inMemoryStore.set(key, value);

    try {
      const payload = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await fetch(CLOUDFLARE_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: payload }),
        timeout: 4000
      });
    } catch (err) {
      console.warn(`[KVStore] Fetch POST for key "${key}" failed, saved to in-memory store:`, err.message);
    }
    return true;
  }

  static async delete(key) {
    inMemoryStore.delete(key);
    try {
      await fetch(`${CLOUDFLARE_WORKER_URL}?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
        timeout: 4000
      });
    } catch (err) {
      console.warn(`[KVStore] Fetch DELETE for key "${key}" failed:`, err.message);
    }
    return true;
  }
}

module.exports = KVStore;
