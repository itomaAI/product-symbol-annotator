window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }

  function deepClone(val) {
    return JSON.parse(JSON.stringify(val));
  }

  class CatalogEditor {
    constructor({ store }) {
      this.store = store;
      this.modalEl = document.getElementById("catalog-modal");
      this.listEl = document.getElementById("catalog-editor-list");
      this.cardEl = document.getElementById("catalog-modal-card");
      this.headerEl = this.cardEl.querySelector(".modal-header");
      this.draftCatalog = [];

      this.initDraggable();

      document.getElementById("catalog-modal-close-btn").addEventListener("click", () => this.close());
      document.getElementById("catalog-modal-cancel-btn").addEventListener("click", () => this.close());
      document.getElementById("catalog-modal-apply-btn").addEventListener("click", () => this.apply());
      
      document.getElementById("add-class-btn").addEventListener("click", () => this.addClass());

      // サイドバーの歯車ボタン（idはそのまま）から呼ばれる
      const openBtn = document.getElementById("class-modal-open-btn");
      if (openBtn) {
        openBtn.addEventListener("click", () => this.open());
      }
    }

    open() {
      this.draftCatalog = deepClone(this.store.getState().catalog);
      this.render();
      this.modalEl.classList.remove("hidden");
      this.modalEl.setAttribute("aria-hidden", "false");
    }

    initDraggable() {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;

      const onMouseDown = (e) => {
        if (e.target.closest("button") || e.target.tagName === "INPUT") return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // 最初のドラッグ時に translate(-50%, -50%) を外して left/top を固定する
        if (!this.cardEl.classList.contains("is-dragged")) {
          const rect = this.cardEl.getBoundingClientRect();
          this.cardEl.classList.add("is-dragged");
          this.cardEl.style.left = rect.left + "px";
          this.cardEl.style.top = rect.top + "px";
        }
        
        startLeft = parseFloat(this.cardEl.style.left) || 0;
        startTop = parseFloat(this.cardEl.style.top) || 0;
        
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };

      const onMouseMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.cardEl.style.left = (startLeft + dx) + "px";
        this.cardEl.style.top = (startTop + dy) + "px";
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      this.headerEl.addEventListener("mousedown", onMouseDown);
    }

    close() {
      this.modalEl.classList.add("hidden");
      this.modalEl.setAttribute("aria-hidden", "true");
    }

    apply() {
      this.store.setCatalog(this.draftCatalog);
      this.close();
    }

    addClass() {
      this.draftCatalog.push({
        id: generateId("cls"),
        type: "class",
        name: "新規クラス",
        description: "",
        color: "rgba(33, 150, 243, 0.24)",
        borderColor: "#2196f3",
        legendImage: null,
        products: []
      });
      this.render();
    }

    addProduct(classIndex) {
      this.draftCatalog[classIndex].products.push({
        id: generateId("prod"),
        type: "product",
        name: "新規製品",
        description: "",
        appearanceImage: null
      });
      this.render();
    }

    removeClass(index) {
      if(confirm("このクラスと配下の製品を削除しますか？")) {
        this.draftCatalog.splice(index, 1);
        this.render();
      }
    }

    removeProduct(classIndex, productIndex) {
      this.draftCatalog[classIndex].products.splice(productIndex, 1);
      this.render();
    }

    render() {
      this.listEl.innerHTML = "";

      if (this.draftCatalog.length === 0) {
        this.listEl.innerHTML = `<div class="empty-state"><p>クラスがありません。「+ シンボルクラスを追加」から追加してください。</p></div>`;
        return;
      }

      const planestData = NS.PlanestData || [];
      
      this.draftCatalog.forEach((cls, cIdx) => {
        const clsEl = document.createElement("div");
        clsEl.className = "editor-class-block";
        
        // カテゴリの選択肢生成
        let catOptions = `<option value="">-- カテゴリ未選択 --</option>`;
        planestData.forEach(cat => {
          const selected = (cls.planestCategoryId === cat.category_code) ? "selected" : "";
          catOptions += `<option value="${cat.category_code}" ${selected}>${cat.category_code} : ${cat.category_name}</option>`;
        });

        // アイテムの選択肢生成
        let itemOptions = `<option value="">-- アイテム未選択 --</option>`;
        let targetItems = [];
        if (cls.planestCategoryId) {
          const targetCat = planestData.find(c => c.category_code === cls.planestCategoryId);
          if (targetCat) targetItems = targetCat.sub_items.map(item => ({ ...item, catCode: targetCat.category_code }));
        } else {
          // 未選択時は全アイテムをフラットに表示
          planestData.forEach(cat => {
            targetItems = targetItems.concat(cat.sub_items.map(item => ({ ...item, catCode: cat.category_code })));
          });
        }
        
        targetItems.forEach(item => {
          const isSelected = (cls.planestItemId === item.code && (cls.planestCategoryId === item.catCode || !cls.planestCategoryId));
          itemOptions += `<option value="${item.code}" data-cat="${item.catCode}" ${isSelected ? "selected" : ""}>${item.catCode}-${item.code} : ${item.name}</option>`;
        });

        clsEl.innerHTML = `
          <div class="editor-row class-row">
            <input type="color" class="color-picker" value="${cls.borderColor}" data-cidx="${cIdx}">
            <div class="editor-inputs">
              <input type="text" class="name-input" placeholder="クラス名 (例: LED埋込天井灯)" value="${cls.name}" data-cidx="${cIdx}" data-field="name">
              <input type="text" class="desc-input" placeholder="仕様・備考" value="${cls.description}" data-cidx="${cIdx}" data-field="description">
              <div class="planest-field">
                <select class="planest-cat-select" data-cidx="${cIdx}">
                  ${catOptions}
                </select>
                <select class="planest-item-select" data-cidx="${cIdx}">
                  ${itemOptions}
                </select>
              </div>
            </div>
            <div class="legend-thumb catalog-editor-thumb ${cls.legendImage ? "has-legend" : ""}">
              ${cls.legendImage ? `<img src="${cls.legendImage}" alt="legend"><button class="legend-delete-btn" data-cidx="${cIdx}" data-type="legend" type="button" title="凡例を削除">×</button>` : `<span class="legend-placeholder" title="図面からの切り抜きはサイドバーで行ってください">▧</span>`}
            </div>
            <button class="btn compact ghost add-prod-btn" data-cidx="${cIdx}">+ 製品追加</button>
            <button class="icon-btn delete-btn" data-cidx="${cIdx}" title="削除">🗑️</button>
          </div>
          <div class="editor-products-list"></div>
        `;

        const prodListEl = clsEl.querySelector(".editor-products-list");
        cls.products.forEach((prod, pIdx) => {
          const prodEl = document.createElement("div");
          prodEl.className = "editor-row product-row";
          prodEl.innerHTML = `
            <div class="tree-line">└</div>
            <div class="editor-inputs">
              <input type="text" class="name-input" placeholder="製品名・型番" value="${prod.name}" data-cidx="${cIdx}" data-pidx="${pIdx}" data-field="name">
              <input type="text" class="desc-input" placeholder="仕様・備考" value="${prod.description}" data-cidx="${cIdx}" data-pidx="${pIdx}" data-field="description">
            </div>
            <div class="legend-thumb catalog-editor-thumb ${prod.appearanceImage ? "has-legend" : ""}">
              ${prod.appearanceImage ? `<img src="${prod.appearanceImage}" alt="appearance"><button class="legend-delete-btn" data-cidx="${cIdx}" data-pidx="${pIdx}" data-type="appearance" type="button" title="姿図を削除">×</button>` : `<span class="legend-placeholder" title="図面からの切り抜きはサイドバーで行ってください">🖼️</span>`}
            </div>
            <button class="icon-btn delete-btn" data-cidx="${cIdx}" data-pidx="${pIdx}" title="削除">🗑️</button>
          `;
          prodListEl.appendChild(prodEl);
        });

        this.listEl.appendChild(clsEl);
      });

      // Event Listeners (Delegation)
      this.listEl.querySelectorAll("input[type='text']").forEach(input => {
        input.addEventListener("input", (e) => {
          const cIdx = e.target.dataset.cidx;
          const pIdx = e.target.dataset.pidx;
          const field = e.target.dataset.field;
          if (pIdx !== undefined) {
            this.draftCatalog[cIdx].products[pIdx][field] = e.target.value;
          } else {
            this.draftCatalog[cIdx][field] = e.target.value;
          }
        });
      });

      this.listEl.querySelectorAll(".color-picker").forEach(input => {
        input.addEventListener("input", (e) => {
          const cIdx = e.target.dataset.cidx;
          const color = e.target.value;
          this.draftCatalog[cIdx].borderColor = color;
        });
      });

      this.listEl.querySelectorAll(".planest-cat-select").forEach(select => {
        select.addEventListener("change", (e) => {
          const cIdx = e.target.dataset.cidx;
          this.draftCatalog[cIdx].planestCategoryId = e.target.value;
          // カテゴリが変わったらアイテムは一旦リセットする
          this.draftCatalog[cIdx].planestItemId = "";
          this.render();
        });
      });

      this.listEl.querySelectorAll(".planest-item-select").forEach(select => {
        select.addEventListener("change", (e) => {
          const cIdx = e.target.dataset.cidx;
          const selectedOption = e.target.options[e.target.selectedIndex];
          this.draftCatalog[cIdx].planestItemId = e.target.value;
          if (e.target.value && selectedOption.dataset.cat) {
            // アイテムからカテゴリを逆引き設定
            this.draftCatalog[cIdx].planestCategoryId = selectedOption.dataset.cat;
          }
          this.render();
        });
      });

      this.listEl.querySelectorAll(".add-prod-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          this.addProduct(e.target.dataset.cidx);
        });
      });

      this.listEl.querySelectorAll(".delete-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const cIdx = e.currentTarget.dataset.cidx;
          const pIdx = e.currentTarget.dataset.pidx;
          if (pIdx !== undefined) {
            this.removeProduct(cIdx, pIdx);
          } else {
            this.removeClass(cIdx);
          }
        });
      });

      this.listEl.querySelectorAll(".legend-delete-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          const cIdx = e.currentTarget.dataset.cidx;
          const pIdx = e.currentTarget.dataset.pidx;
          const type = e.currentTarget.dataset.type;
          
          if (type === "legend") {
            this.draftCatalog[cIdx].legendImage = null;
          } else if (type === "appearance") {
            this.draftCatalog[cIdx].products[pIdx].appearanceImage = null;
          }
          this.render();
        });
      });
    }
  }

  NS.CatalogEditor = CatalogEditor;
})(window.SymbolAnnotator);