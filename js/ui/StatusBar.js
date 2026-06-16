window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class StatusBar {
    constructor({ store }) {
      this.store = store;
      this.projectEl = document.getElementById("project-status");
      this.modeEl = document.getElementById("mode-status");
      this.selectionEl = document.getElementById("selection-status");
      this.statsEl = document.getElementById("stats-status");

      store.on("project:changed", () => this.render());
      store.on("selection:changed", () => this.render());
      store.on("annotations:changed", () => this.render());
      store.on("catalog:changed", () => this.render());
      store.on("state:changed", () => this.render());
      this.render();
    }

    render() {
      const state = this.store.getState();
      const stats = this.store.getStats();
      const selection = this.store.getSelectionSummary();

      if (state.project.pageCount > 0) {
        this.projectEl.textContent = `${state.project.filename} · Page ${state.currentPage}/${state.project.pageCount} · Render ${state.pdfRenderScale.toFixed(1)}x`;
      } else {
        this.projectEl.textContent = "No PDF loaded";
      }

      let modeLabel = "Idle";
      if (selection.pendingImageTarget) {
        const typeLabel = selection.pendingImageTarget.type === 'legend' ? '凡例' : '姿図';
        modeLabel = `Capture Image (${typeLabel})`;
      } else if (selection.selectedProduct) {
        modeLabel = `Annotate (${selection.selectedClass?.name} > ${selection.selectedProduct.name})`;
      } else if (selection.selectedClass) {
        modeLabel = `Annotate (${selection.selectedClass.name})`;
      } else if (selection.selectedAnnotation) {
        modeLabel = "Edit annotation";
      }
      this.modeEl.textContent = `Mode: ${modeLabel}`;

      if (selection.selectedAnnotation) {
        this.selectionEl.textContent = `Selection: ${selection.selectedAnnotation.id}`;
      } else if (selection.selectedProduct) {
        this.selectionEl.textContent = `Selection: ${selection.selectedProduct.id}`;
      } else if (selection.selectedClass) {
        this.selectionEl.textContent = `Selection: ${selection.selectedClass.id}`;
      } else if (selection.pendingImageTarget) {
        this.selectionEl.textContent = `Selection: Image target ${selection.pendingImageTarget.nodeId}`;
      } else {
        this.selectionEl.textContent = "Selection: none";
      }

      this.statsEl.textContent = `Boxes: ${stats.annotationCount} / Legends: ${stats.legendCount} / Appearances: ${stats.appearanceCount}`;
    }
  }

  NS.StatusBar = StatusBar;
})(window.SymbolAnnotator);