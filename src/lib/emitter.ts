/**
 * Minimal typed event emitter.
 *
 * Each pipeline object owns its own emitter instance, so subscriptions die
 * with the object that created them. There is deliberately no global bus:
 * the previous global singleton leaked handlers across reading sessions.
 */
export type Unsubscribe = () => void;

export class Emitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): Unsubscribe {
    (this.handlers[type] ??= new Set()).add(handler);
    return () => this.handlers[type]?.delete(handler);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers[type];
    if (!set) return;
    // Copy so a handler may unsubscribe while we iterate.
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        // One faulty listener must not break the frame loop.
        console.error(`[emitter] listener for "${String(type)}" threw`, err);
      }
    }
  }

  listenerCount<K extends keyof Events>(type: K): number {
    return this.handlers[type]?.size ?? 0;
  }

  clear(): void {
    this.handlers = {};
  }
}
