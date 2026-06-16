window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class Toolbar {
    constructor({ store, pdfService, exportService, canvasWorkspace, toast }) {
      this.store = store;
      this.pdfService = pdfService;
      this.exportService = exportService;
      this.canvasWorkspace = canvasWorkspace;
      this.toast = toast;

      this.pdfInput = document.getElementById("pdf-input");
      this.emptyPdfInput = document.getElementById("empty-pdf-input");
      this.projectInput = document.getElementById("project-input");
      this.scaleInput = document.getElementById("render-scale-input");
      this.pageInput = document.getElementById("page-input");
      this.pageTotal = document.getElementById("page-total");
      this.pagebar = document.getElementById("pagebar");
      this.emptyState = document.getElementById("empty-state");
      this.workspace = document.querySelector(".workspace");

      this.bind();
      this.bindStore();
    }

    bind() {
      this.pdfInput.addEventListener("change", event => this.openPdfFromInput(event.target));
      this.emptyPdfInput.addEventListener("change", event => this.openPdfFromInput(event.target));
      this.projectInput.addEventListener("change", event => this.loadProjectFromInput(event.target));

      document.getElementById("save-project-btn").addEventListener("click", () => this.saveProject());
      document.getElementById("export-dataset-btn").addEventListener("click", () => this.exportDataset());

      this.scaleInput.addEventListener("change", async () => {
        const next = Math.max(1, Math.min(10, parseFloat(this.scaleInput.value) || NS.Config.pdfRenderScale));
        this.scaleInput.value = next.toFixed(1);
        this.store.setRenderScale(next);
        if (this.store.getState().project.pageCount > 0) {
          await this.canvasWorkspace.renderCurrentPage({ fit: false });
        }
      });

      document.getElementById("prev-page-btn").addEventListener("click", () => this.changePage(this.store.getState().currentPage - 1));
      document.getElementById("next-page-btn").addEventListener("click", () => this.changePage(this.store.getState().currentPage + 1));
      this.pageInput.addEventListener("change", () => this.changePage(parseInt(this.pageInput.value, 10)));
      document.getElementById("fit-view-btn").addEventListener("click", () => this.canvasWorkspace.fitToViewport());
      document.getElementById("actual-size-btn").addEventListener("click", () => this.canvasWorkspace.actualSize());

      window.addEventListener("keydown", event => this.handleKeyDown(event));
    }

    bindStore() {
      this.store.on("project:changed", () => this.syncProjectUi());
      this.store.on("page:changed", () => this.syncProjectUi());
      this.store.on("renderScale:changed", scale => {
        this.scaleInput.value = scale.toFixed(1);
      });
    }

    syncProjectUi() {
      const state = this.store.getState();
      const hasPdf = state.project.pageCount > 0;
      this.emptyState.classList.toggle("hidden", hasPdf);
      this.pagebar.classList.toggle("hidden", !hasPdf);
      this.workspace.classList.toggle("has-pdf", hasPdf);
      this.pageInput.value = state.currentPage;
      this.pageInput.max = state.project.pageCount || 1;
      this.pageTotal.textContent = state.project.pageCount || "?";
    }

    async openPdfFromInput(input) {
      const file = input.files?.[0];
      if (!file) return;

      try {
        this.store.resetProject();
        const buffer = await file.arrayBuffer();
        const info = await this.pdfService.loadFromBuffer(buffer);
        this.store.setPdfBuffer(buffer);
        this.store.setProjectInfo({ filename: file.name, pageCount: info.pageCount });
        this.store.setCurrentPage(1);
        await this.canvasWorkspace.renderCurrentPage({ fit: true });
        this.toast.success("PDFを読み込みました。");
      } catch (error) {
        console.error(error);
        this.toast.error(`PDF読み込みに失敗しました: ${error.message}`);
      } finally {
        input.value = "";
      }
    }

    async loadProjectFromInput(input) {
      const file = input.files?.[0];
      if (!file) return;

      try {
        await this.exportService.loadProject(file);
        const state = this.store.getState();
        this.store.setCurrentPage(state.currentPage || 1);
        this.scaleInput.value = state.pdfRenderScale.toFixed(1);
        await this.canvasWorkspace.renderCurrentPage({ fit: true });
        this.toast.success("プロジェクトを読み込みました。");
      } catch (error) {
        console.error(error);
        this.toast.error(`プロジェクト読み込みに失敗しました: ${error.message}`);
      } finally {
        input.value = "";
      }
    }

    async changePage(pageNumber) {
      const state = this.store.getState();
      if (!state.project.pageCount) return;
      const page = Math.max(1, Math.min(state.project.pageCount, pageNumber || 1));
      this.store.setCurrentPage(page);
      await this.canvasWorkspace.renderCurrentPage({ fit: false });
    }

    async saveProject() {
      try {
        await this.exportService.saveProject();
        this.toast.success("プロジェクトを書き出しました。");
      } catch (error) {
        this.toast.error(error.message);
      }
    }

    async exportDataset() {
      const button = document.getElementById("export-dataset-btn");
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Exporting...";
      try {
        await this.exportService.exportDataset(progress => {
          if (progress.phase === "page") {
            button.textContent = `Render ${progress.current}/${progress.total}`;
          } else if (progress.phase === "zip") {
            button.textContent = "Zipping...";
          }
        });
        this.toast.success("データセットを書き出しました。");
      } catch (error) {
        console.error(error);
        this.toast.error(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }

    handleKeyDown(event) {
      const target = event.target;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((event.key === "Delete" || event.key === "Backspace") && !isInput) {
        const removed = this.store.removeSelectedAnnotation();
        if (removed) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Escape") {
        this.store.selectClass(null);
        this.store.setPendingLegendClass(null);
        this.store.selectAnnotation(null);
        event.preventDefault();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && !isInput) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) {
            this.store.redo();
          } else {
            this.store.undo();
          }
          return;
        }
        if (key === "y") {
          event.preventDefault();
          this.store.redo();
          return;
        }
      }

      if (!isInput && event.key >= "1" && event.key <= "9") {
        const index = parseInt(event.key, 10) - 1;
        const active = this.store.getActiveClasses();
        if (active[index]) {
          event.preventDefault();
          this.store.selectClass(active[index].id);
        }
      }
    }
  }

  NS.Toolbar = Toolbar;
})(window.SymbolAnnotator);