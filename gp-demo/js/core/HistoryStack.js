window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  class HistoryStack {
    constructor(limit = 80) {
      this.limit = limit;
      this.stack = [];
      this.index = -1;
    }

    clear() {
      this.stack = [];
      this.index = -1;
    }

    push(snapshot) {
      if (this.index < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.index + 1);
      }

      this.stack.push(deepClone(snapshot));
      this.index += 1;

      if (this.stack.length > this.limit) {
        this.stack.shift();
        this.index -= 1;
      }
    }

    undo() {
      if (this.index <= 0) return null;
      this.index -= 1;
      return deepClone(this.stack[this.index]);
    }

    redo() {
      if (this.index >= this.stack.length - 1) return null;
      this.index += 1;
      return deepClone(this.stack[this.index]);
    }

    get canUndo() {
      return this.index > 0;
    }

    get canRedo() {
      return this.index < this.stack.length - 1;
    }
  }

  NS.HistoryStack = HistoryStack;
})(window.SymbolAnnotator);