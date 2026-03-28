import storageService from './storageService';

class InteractionService {
  constructor() {
    this.enableTracking = true;
    this.eventQueue = [];
    this.flushTimer = null;
  }

  setTrackingEnabled(enabled) {
    this.enableTracking = !!enabled;

    if (!this.enableTracking) {
      this.cancelFlush();
      this.eventQueue = [];
    }
  }

  captureEvent(event) {
    if (!this.enableTracking || !event) {
      return;
    }

    this.eventQueue.push(event);

    if (this.eventQueue.length >= 50) {
      this.flushEvents();
    }
  }

  captureEvents(events) {
    if (!this.enableTracking || !Array.isArray(events)) {
      return;
    }

    events.forEach((event) => this.captureEvent(event));
  }

  flushEvents() {
    if (this.eventQueue.length === 0) {
      return;
    }

    const eventsToFlush = this.eventQueue.splice(0, this.eventQueue.length);
    storageService.addEvents(eventsToFlush);
    storageService.flushToStorage();
  }

  scheduleFlush(interval = 2000) {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      this.flushEvents();
    }, interval);
  }

  cancelFlush() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  getSessionEvents() {
    return [
      ...this.eventQueue,
      ...storageService.getSessionEvents(),
    ];
  }

  getSessionId() {
    return storageService.getSessionId();
  }

  clearSession() {
    this.eventQueue = [];
    storageService.clearSession();
  }

  getStats() {
    return {
      queuedEvents: this.eventQueue.length,
      sessionId: this.getSessionId(),
      trackingEnabled: this.enableTracking,
    };
  }
}

export default new InteractionService();
