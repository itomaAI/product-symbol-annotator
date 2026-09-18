window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class App {
    constructor() {
      this.store = new NS.Store();
      this.pdfService = new NS.PdfService();
      this.toast = new NS.Toast(document.getElementById("toast-root"));
      this.canvasWorkspace = new NS.CanvasWorkspace({
        store: this.store,
        pdfService: this.pdfService,
        toast: this.toast
      });
      this.exportService = new NS.ExportService({
        store: this.store,
        pdfService: this.pdfService
      });

      this.statusBar = new NS.StatusBar({ store: this.store });
      this.sidebar = new NS.ClassSidebar({ store: this.store });
      this.catalogEditor = new NS.CatalogEditor({ store: this.store });
      this.batchEditor = new NS.BatchEditor({ store: this.store });
      this.toolbar = new NS.Toolbar({
        store: this.store,
        pdfService: this.pdfService,
        exportService: this.exportService,
        canvasWorkspace: this.canvasWorkspace,
        toast: this.toast
      });
    }

    start() {
      this.detectOS();
      console.log("Symbol Annotator started.");
    }

    detectOS() {
      const isMac = navigator.userAgent.includes("Mac") || navigator.platform.includes("Mac");
      const ctrlKeyEl = document.getElementById("hint-ctrl-key");
      if (isMac && ctrlKeyEl) {
        ctrlKeyEl.textContent = "⌘ Cmd";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    NS.app = new App();
    NS.app.start();
  });
})(window.SymbolAnnotator);