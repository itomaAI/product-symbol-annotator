window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class BatchEditor {
    constructor({ store }) {
      this.store = store;
      this.modalEl = document.getElementById("batch-edit-modal");
      this.descEl = document.getElementById("batch-edit-count-desc");
      this.classSelect = document.getElementById("batch-edit-class-select");
      this.productSelect = document.getElementById("batch-edit-product-select");

      document.getElementById("batch-edit-close-btn").addEventListener("click", () => this.close());
      document.getElementById("batch-edit-cancel-btn").addEventListener("click", () => this.close());
      document.getElementById("batch-edit-apply-btn").addEventListener("click", () => this.apply());

      this.classSelect.addEventListener("change", () => this.onClassChange());
    }

    open() {
      const state = this.store.getState();
      const ids = state.selectedAnnotationIds;
      if (!ids || ids.length === 0) return;

      this.descEl.textContent = `選択された ${ids.length} 個のアノテーション`;

      // 選択されているアノテーションの現在のラベル状況を調べる
      const annotations = this.store.getPageAnnotations().filter(a => ids.includes(a.id));
      
      let commonClassId = annotations[0].classId;
      let commonProductId = annotations[0].productId;
      
      for (const ann of annotations) {
        if (ann.classId !== commonClassId) commonClassId = null;
        if (ann.productId !== commonProductId) commonProductId = null;
      }

      // クラス選択肢の構築
      this.classSelect.innerHTML = `<option value="">-- 選択 --</option>`;
      state.catalog.forEach(cls => {
        const opt = document.createElement("option");
        opt.value = cls.id;
        opt.textContent = cls.name;
        this.classSelect.appendChild(opt);
      });

      if (commonClassId) {
        this.classSelect.value = commonClassId;
      } else {
        // 混在している場合
        const mixedOpt = document.createElement("option");
        mixedOpt.value = "";
        mixedOpt.textContent = "-- (複数混在) --";
        mixedOpt.selected = true;
        this.classSelect.insertBefore(mixedOpt, this.classSelect.firstChild);
      }

      // 製品選択肢の構築 (親が共通で決まっている場合のみ)
      this.buildProductOptions(commonClassId);

      if (commonProductId && commonClassId) {
        this.productSelect.value = commonProductId;
      } else if (commonClassId) {
        // 親は共通だが子が混在している場合
        const mixedOpt = document.createElement("option");
        mixedOpt.value = "";
        mixedOpt.textContent = "-- (複数混在) --";
        mixedOpt.selected = true;
        this.productSelect.insertBefore(mixedOpt, this.productSelect.firstChild);
      }

      this.modalEl.classList.remove("hidden");
      this.modalEl.setAttribute("aria-hidden", "false");
    }

    onClassChange() {
      const classId = this.classSelect.value;
      this.buildProductOptions(classId);
    }

    buildProductOptions(classId) {
      this.productSelect.innerHTML = `<option value="">-- (なし) --</option>`;
      if (!classId) return;

      const cls = this.store.findNode(classId);
      if (cls && cls.products) {
        cls.products.forEach(prod => {
          const opt = document.createElement("option");
          opt.value = prod.id;
          opt.textContent = prod.name;
          this.productSelect.appendChild(opt);
        });
      }
    }

    close() {
      this.modalEl.classList.add("hidden");
      this.modalEl.setAttribute("aria-hidden", "true");
    }

    apply() {
      const classId = this.classSelect.value;
      const productId = this.productSelect.value;

      if (!classId) {
        alert("シンボルクラスを選択してください。");
        return;
      }

      const state = this.store.getState();
      const ids = state.selectedAnnotationIds;
      
      this.store.updateAnnotationsLabels(ids, classId, productId || null);
      this.close();
    }
  }

  NS.BatchEditor = BatchEditor;
})(window.SymbolAnnotator);