window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class Toast {
    constructor(root) {
      this.root = root;
    }

    show(message, type = "info", timeout = 3200) {
      const el = document.createElement("div");
      el.className = `toast ${type}`;
      el.textContent = message;
      this.root.appendChild(el);
      window.setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(6px)";
        window.setTimeout(() => el.remove(), 180);
      }, timeout);
    }

    success(message) {
      this.show(message, "success");
    }

    warning(message) {
      this.show(message, "warning");
    }

    error(message) {
      this.show(message, "error", 5200);
    }
  }

  NS.Toast = Toast;
})(window.SymbolAnnotator);