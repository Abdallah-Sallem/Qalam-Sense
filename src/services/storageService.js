import {
  compressEventBatch,
  decompressEventBatch,
} from '../utils/compressionUtils';

const STORAGE_KEY_PREFIX = 'qalam.tracking.session.';
const MAX_MEMORY_BUFFER = 5000;

class StorageService {
  constructor() {
    this.memoryBuffer = [];
    this.sessionId = this.generateSessionId();
    this.flushTimer = null;
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  addEvent(event) {
    if (!event || typeof event !== 'object') {
      return;
    }

    this.memoryBuffer.push(event);

    if (this.memoryBuffer.length > MAX_MEMORY_BUFFER) {
      this.memoryBuffer.shift();
    }
  }

  addEvents(events) {
    if (!Array.isArray(events)) {
      return;
    }

    events.forEach((event) => this.addEvent(event));
  }

  flushToStorage() {
    if (this.memoryBuffer.length === 0) {
      return;
    }

    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const compressed = compressEventBatch(this.memoryBuffer);
      const key = `${STORAGE_KEY_PREFIX}${this.sessionId}`;
      const stored = window.localStorage.getItem(key);
      const batch = stored ? JSON.parse(stored) : [];
      const updated = batch.concat(compressed);
      window.localStorage.setItem(key, JSON.stringify(updated));
    } catch (error) {
      console.warn('Failed to flush events to storage:', error);
    }
  }

  getMemoryBuffer() {
    return [...this.memoryBuffer];
  }

  getSessionEvents() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return this.getMemoryBuffer();
    }

    try {
      const key = `${STORAGE_KEY_PREFIX}${this.sessionId}`;
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const batch = JSON.parse(stored);
        return decompressEventBatch(batch);
      }
    } catch (error) {
      console.warn('Failed to retrieve session events:', error);
    }

    return this.getMemoryBuffer();
  }

  clearSession() {
    this.memoryBuffer = [];

    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const key = `${STORAGE_KEY_PREFIX}${this.sessionId}`;
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear session:', error);
    }
  }

  getBufferSize() {
    return this.memoryBuffer.length;
  }

  getSessionId() {
    return this.sessionId;
  }

  scheduleFlush(interval = 2000) {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.memoryBuffer.length >= 50 || Date.now() % interval === 0) {
        this.flushToStorage();
      }
    }, interval);
  }

  cancelFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

export default new StorageService();
