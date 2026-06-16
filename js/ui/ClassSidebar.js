window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class ClassSidebar {
    constructor({ store }) {
      this.store = store;
      this.listEl = document.getElementById("class-list");
      this.expandedClasses = new Set(); // アコーディオンの開閉状態を保持

      store.on("catalog:changed", () => this.render());
      store.on("selection:changed", () => this.render());
      store.on("annotations:changed", () => this.render());
      this.render();
    }

    countAnnotations(nodeId, type) {
      const state = this.store.getState();
      return Object.values(state.annotations).reduce((sum, list) => {
        if (type === 'class') {
          return sum + list.filter(item => item.classId === nodeId).length;
        } else {
          return sum + list.filter(item => item.productId === nodeId).length;
        }
      }, 0);
    }

    toggleExpand(classId, event) {
      if (event) event.stopPropagation();
      if (this.expandedClasses.has(classId)) {
        this.expandedClasses.delete(classId);
      } else {
        this.expandedClasses.add(classId);
      }
      this.render();
    }

    render() {
      const state = this.store.getState();
      const catalog = state.catalog || [];
      this.listEl.innerHTML = "";

      if (catalog.length === 0) {
        const li = document.createElement("li");
        li.className = "class-empty";
        li.innerHTML = "⚙ ボタンから<br>使用するクラスを追加してください。";
        this.listEl.appendChild(li);
        return;
      }

      catalog.forEach((cls, index) => {
        const isExpanded = this.expandedClasses.has(cls.id);
        const hasProducts = cls.products && cls.products.length > 0;
        const isSelected = state.selectedClassId === cls.id && state.selectedProductId === null;
        const hasChildSelected = state.selectedClassId === cls.id && state.selectedProductId !== null;
        const isPendingLegend = state.pendingImageTarget?.nodeId === cls.id && state.pendingImageTarget?.type === 'legend';

        const li = document.createElement("li");
        li.className = `class-item catalog-class-item ${isSelected ? "selected" : ""} ${hasChildSelected ? "has-child-selected" : ""} ${isPendingLegend ? "legend-pending" : ""}`;
        li.dataset.nodeId = cls.id;

        const annotationCount = this.countAnnotations(cls.id, 'class');
        const shortcut = index < 9 ? String(index + 1) : "·";

        // 親クラス（シンボル）のHTML構築
        li.innerHTML = `
          <div class="class-row main-row">
            ${hasProducts ? `<button class="toggle-btn" type="button">${isExpanded ? '▼' : '▶'}</button>` : `<span class="toggle-placeholder"></span>`}
            <div class="class-color" style="background:${cls.borderColor}"></div>
            <div class="class-shortcut">${shortcut}</div>
            <div class="class-name">
              ${cls.name}
              <div class="class-id">${cls.description || ''}</div>
            </div>
            <div class="legend-thumb ${isPendingLegend ? "pending" : ""} ${cls.legendImage ? "has-legend" : ""}" title="${cls.legendImage ? "クリックで凡例を再取得、×で削除" : "凡例を図面から切り抜く"}">
              ${cls.legendImage ? `
                <img src="${cls.legendImage}" alt="${cls.name} legend">
                <button class="legend-delete-btn" type="button" title="凡例を削除" data-type="legend">×</button>
              ` : `<span class="legend-placeholder">▧</span>`}
            </div>
          </div>
          <div class="class-meta-row">
            <span>Total: ${annotationCount} boxes</span>
          </div>
        `;

        // 子製品（姿図）のHTML構築
        if (hasProducts && isExpanded) {
          const prodContainer = document.createElement("ul");
          prodContainer.className = "product-list";
          
          cls.products.forEach(prod => {
            const isProdSelected = state.selectedProductId === prod.id;
            const isPendingAppearance = state.pendingImageTarget?.nodeId === prod.id && state.pendingImageTarget?.type === 'appearance';
            const prodCount = this.countAnnotations(prod.id, 'product');
            
            const pLi = document.createElement("li");
            pLi.className = `class-item catalog-product-item ${isProdSelected ? "selected" : ""} ${isPendingAppearance ? "legend-pending" : ""}`;
            pLi.dataset.nodeId = prod.id;

            pLi.innerHTML = `
              <div class="class-row">
                <div class="tree-line">└</div>
                <div class="class-name">
                  ${prod.name}
                  <div class="class-id">${prod.description || ''}</div>
                </div>
                <div class="legend-thumb ${isPendingAppearance ? "pending" : ""} ${prod.appearanceImage ? "has-legend" : ""}" title="${prod.appearanceImage ? "クリックで姿図を再取得、×で削除" : "姿図を図面から切り抜く"}">
                  ${prod.appearanceImage ? `
                    <img src="${prod.appearanceImage}" alt="${prod.name} appearance">
                    <button class="legend-delete-btn" type="button" title="姿図を削除" data-type="appearance">×</button>
                  ` : `<span class="legend-placeholder">🖼️</span>`}
                </div>
              </div>
              <div class="class-meta-row">
                <span>${prodCount} boxes</span>
              </div>
            `;

            // 製品クリック
            pLi.addEventListener("click", event => {
              event.stopPropagation();
              if (event.target.closest(".legend-thumb")) return;
              if (state.selectedProductId === prod.id) {
                this.store.selectNode(null); // トグル解除
              } else {
                this.store.selectNode(prod.id);
              }
            });

            // 製品画像・プレースホルダークリック
            pLi.querySelector(".legend-thumb").addEventListener("click", event => {
              event.stopPropagation();
              if (event.target.closest(".legend-delete-btn")) return;
              
              if (prod.appearanceImage && event.target.tagName === 'IMG') {
                // 画像がすでにある場合、それをクリックしたらプレビューを開く
                const modal = document.getElementById("image-preview-modal");
                const img = document.getElementById("image-preview-img");
                if (modal && img) {
                  img.src = prod.appearanceImage;
                  modal.classList.remove("hidden");
                  modal.setAttribute("aria-hidden", "false");
                  
                  // 閉じる処理を1回だけ登録
                  const closeBtn = document.getElementById("image-preview-close-btn");
                  const closeModal = () => {
                    modal.classList.add("hidden");
                    modal.setAttribute("aria-hidden", "true");
                    closeBtn.removeEventListener("click", closeModal);
                    modal.removeEventListener("click", overlayClick);
                  };
                  const overlayClick = (e) => { if(e.target === modal) closeModal(); };
                  closeBtn.addEventListener("click", closeModal);
                  modal.addEventListener("click", overlayClick);
                }
                return;
              }

              // 画像がない（プレースホルダー）、または何らかの理由で切り抜きモードに入りたい場合
              const nextTarget = (state.pendingImageTarget?.nodeId === prod.id) ? null : { nodeId: prod.id, type: 'appearance' };
              this.store.setPendingImageTarget(nextTarget?.nodeId, nextTarget?.type);
            });

            const delBtn = pLi.querySelector(".legend-delete-btn");
            if (delBtn) {
              delBtn.addEventListener("click", event => {
                event.stopPropagation();
                this.store.removeCatalogImage(prod.id, 'appearance');
              });
            }

            prodContainer.appendChild(pLi);
          });
          li.appendChild(prodContainer);
        }

        // 親クリック
        const mainRow = li.querySelector(".main-row");
        mainRow.addEventListener("click", event => {
          if (event.target.closest(".toggle-btn") || event.target.closest(".legend-thumb")) return;
          if (state.selectedClassId === cls.id && state.selectedProductId === null) {
            this.store.selectNode(null);
          } else {
            this.store.selectNode(cls.id);
          }
        });

        const toggleBtn = li.querySelector(".toggle-btn");
        if (toggleBtn) {
          toggleBtn.addEventListener("click", e => this.toggleExpand(cls.id, e));
        }

        // 親画像・プレースホルダークリック
        mainRow.querySelector(".legend-thumb").addEventListener("click", event => {
          event.stopPropagation();
          if (event.target.closest(".legend-delete-btn")) return;
          
          if (cls.legendImage && event.target.tagName === 'IMG') {
            // 画像がすでにある場合、それをクリックしたらプレビューを開く
            const modal = document.getElementById("image-preview-modal");
            const img = document.getElementById("image-preview-img");
            if (modal && img) {
              img.src = cls.legendImage;
              modal.classList.remove("hidden");
              modal.setAttribute("aria-hidden", "false");
              
              const closeBtn = document.getElementById("image-preview-close-btn");
              const closeModal = () => {
                modal.classList.add("hidden");
                modal.setAttribute("aria-hidden", "true");
                closeBtn.removeEventListener("click", closeModal);
                modal.removeEventListener("click", overlayClick);
              };
              const overlayClick = (e) => { if(e.target === modal) closeModal(); };
              closeBtn.addEventListener("click", closeModal);
              modal.addEventListener("click", overlayClick);
            }
            return;
          }

          const nextTarget = (state.pendingImageTarget?.nodeId === cls.id) ? null : { nodeId: cls.id, type: 'legend' };
          this.store.setPendingImageTarget(nextTarget?.nodeId, nextTarget?.type);
        });

        const parentDelBtn = mainRow.querySelector(".legend-delete-btn");
        if (parentDelBtn) {
          parentDelBtn.addEventListener("click", event => {
            event.stopPropagation();
            this.store.removeCatalogImage(cls.id, 'legend');
          });
        }

        this.listEl.appendChild(li);
      });
    }
  }

  NS.ClassSidebar = ClassSidebar;
})(window.SymbolAnnotator);