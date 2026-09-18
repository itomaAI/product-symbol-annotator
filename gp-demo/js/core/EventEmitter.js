window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class EventEmitter {
    constructor() {
      this.listeners = new Map();
    }

    on(eventName, handler) {
      if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, new Set());
      }
      this.listeners.get(eventName).add(handler);
      return () => this.off(eventName, handler);
    }

    off(eventName, handler) {
      const set = this.listeners.get(eventName);
      if (!set) return;
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(eventName);
      }
    }

    emit(eventName, payload) {
      const set = this.listeners.get(eventName);
      if (!set) return;
      [...set].forEach(handler => handler(payload));
    }
  }

  NS.EventEmitter = EventEmitter;
})(window.SymbolAnnotator);