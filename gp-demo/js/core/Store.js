window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createInitialState() {
    return {
      project: {
        filename: "",
        pageCount: 0,
        pageDimensions: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      currentPage: 1,
      pdfRenderScale: NS.Config.pdfRenderScale,
      pdfBuffer: null,
      
      // 動的カタログツリー
      catalog: deepClone(NS.Config.defaultCatalog || []),
      
      // 選択状態
      selectedClassId: null,
      selectedProductId: null,
      selectedAnnotationIds: [], // 複数選択対応
      
      // 画像切り抜き待機状態
      pendingImageTarget: null, // { nodeId: string, type: 'legend' | 'appearance' } | null
      
      annotations: {}
    };
  }

  function roundRatio(value) {
    return Math.round(value * 100000000) / 100000000;
  }

  function roundPixel(value) {
    return Math.round(value * 100) / 100;
  }

  class Store extends NS.EventEmitter {
    constructor() {
      super();
      this.state = createInitialState();
      this.history = new NS.HistoryStack(NS.Config.maxHistory);
      this.resetHistory();
    }

    getState() {
      return this.state;
    }

    // カタログ検索メソッド
    findNode(id) {
      for (const cls of this.state.catalog) {
        if (cls.id === id) return cls;
        const prod = cls.products.find(p => p.id === id);
        if (prod) return prod;
      }
      return null;
    }

    findClassOfProduct(productId) {
      return this.state.catalog.find(cls => cls.products.some(p => p.id === productId)) || null;
    }

    touch() {
      this.state.project.updatedAt = new Date().toISOString();
    }

    emitAll() {
      this.emit("state:changed", this.state);
      this.emit("catalog:changed", this.state.catalog);
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("project:changed", this.state.project);
    }

    snapshotForHistory() {
      return {
        catalog: deepClone(this.state.catalog),
        annotations: deepClone(this.state.annotations)
      };
    }

    resetHistory() {
      this.history.clear();
      this.history.push(this.snapshotForHistory());
      this.emit("history:changed", { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    }

    commit() {
      this.touch();
      this.history.push(this.snapshotForHistory());
      this.emit("history:changed", { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
      this.emit("state:changed", this.state);
    }

    undo() {
      const restored = this.history.undo();
      if (!restored) return false;
      this.state.catalog = restored.catalog;
      this.state.annotations = restored.annotations;
      this.state.selectedAnnotationIds = [];
      this.emit("catalog:changed", this.state.catalog);
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("history:changed", { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
      this.emit("state:changed", this.state);
      return true;
    }

    redo() {
      const restored = this.history.redo();
      if (!restored) return false;
      this.state.catalog = restored.catalog;
      this.state.annotations = restored.annotations;
      this.state.selectedAnnotationIds = [];
      this.emit("catalog:changed", this.state.catalog);
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("history:changed", { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
      this.emit("state:changed", this.state);
      return true;
    }

    resetProject() {
      const pdfRenderScale = this.state.pdfRenderScale;
      this.state = createInitialState();
      this.state.pdfRenderScale = pdfRenderScale;
      this.resetHistory();
      this.emitAll();
    }

    setPdfBuffer(buffer) {
      this.state.pdfBuffer = buffer;
    }

    setProjectInfo({ filename, pageCount }) {
      this.state.project.filename = filename;
      this.state.project.pageCount = pageCount;
      this.touch();
      this.emit("project:changed", this.state.project);
      this.emit("state:changed", this.state);
    }

    setPageDimension(pageNumber, dimensions) {
      this.state.project.pageDimensions[String(pageNumber)] = {
        width: dimensions.width,
        height: dimensions.height
      };
      this.emit("project:changed", this.state.project);
    }

    getPageDimensions(pageNumber = this.state.currentPage) {
      const key = String(pageNumber);
      const dimensions = this.state.project.pageDimensions[key];
      if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
        return dimensions;
      }
      return { width: 0, height: 0 };
    }

    isProbablyPixelBbox(bbox) {
      return Array.isArray(bbox) && bbox.some(value => Math.abs(value) > 1);
    }

    normalizeBbox(pageNumber, pixelBbox) {
      const dimensions = this.getPageDimensions(pageNumber);
      const [x, y, w, h] = pixelBbox;
      if (!dimensions.width || !dimensions.height) {
        return [x, y, w, h].map(roundPixel);
      }

      return [
        roundRatio(x / dimensions.width),
        roundRatio(y / dimensions.height),
        roundRatio(w / dimensions.width),
        roundRatio(h / dimensions.height)
      ];
    }

    denormalizeBbox(pageNumber, bbox) {
      if (!Array.isArray(bbox)) return [0, 0, 0, 0];

      // Backward-compatible guard for older project files that stored rendered pixels.
      if (this.isProbablyPixelBbox(bbox)) {
        return bbox.map(roundPixel);
      }

      const dimensions = this.getPageDimensions(pageNumber);
      if (!dimensions.width || !dimensions.height) {
        return bbox.map(roundPixel);
      }

      return [
        roundPixel(bbox[0] * dimensions.width),
        roundPixel(bbox[1] * dimensions.height),
        roundPixel(bbox[2] * dimensions.width),
        roundPixel(bbox[3] * dimensions.height)
      ];
    }

    setCurrentPage(pageNumber) {
      const page = Math.max(1, Math.min(pageNumber, this.state.project.pageCount || pageNumber));
      this.state.currentPage = page;
      this.state.selectedAnnotationId = null;
      if (!this.state.annotations[String(page)]) {
        this.state.annotations[String(page)] = [];
      }
      this.emit("page:changed", page);
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("state:changed", this.state);
    }

    setRenderScale(scale) {
      const next = Math.max(1, Math.min(10, Number(scale) || NS.Config.pdfRenderScale));
      this.state.pdfRenderScale = next;
      this.emit("renderScale:changed", next);
      this.emit("state:changed", this.state);
    }

    // === カタログ操作メソッド ===
    setCatalog(catalog) {
      this.state.catalog = catalog;
      this.commit();
      this.emit("catalog:changed", this.state.catalog);
    }

    setCatalogImage(nodeId, type, imgData) {
      const node = this.findNode(nodeId);
      if (!node) return false;
      
      if (type === 'legend') {
        node.legendImage = imgData;
      } else if (type === 'appearance') {
        node.appearanceImage = imgData;
      }
      
      this.state.pendingImageTarget = null;
      this.commit();
      this.emit("catalog:changed", this.state.catalog);
      this.emit("selection:changed", this.getSelectionSummary());
      return true;
    }

    removeCatalogImage(nodeId, type) {
      const node = this.findNode(nodeId);
      if (!node) return false;
      
      if (type === 'legend') {
        node.legendImage = null;
      } else if (type === 'appearance') {
        node.appearanceImage = null;
      }
      
      this.commit();
      this.emit("catalog:changed", this.state.catalog);
      return true;
    }

    // === 選択状態の操作 ===
    selectNode(nodeId) {
      const node = this.findNode(nodeId);
      if (!node) {
        // 解除時はカタログの選択のみをリセットし、アノテーション選択は維持する
        this.state.selectedClassId = null;
        this.state.selectedProductId = null;
      } else {
        // クラス/製品を新規選択した場合は、アノテーションの選択を解除する（排他的）
        if (node.type === 'class') {
          this.state.selectedClassId = node.id;
          this.state.selectedProductId = null;
        } else if (node.type === 'product') {
          const parentClass = this.findClassOfProduct(node.id);
          this.state.selectedClassId = parentClass ? parentClass.id : null;
          this.state.selectedProductId = node.id;
        }
        this.state.selectedAnnotationIds = [];
      }

      this.state.pendingImageTarget = null;
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("state:changed", this.state);
    }

    setPendingImageTarget(nodeId, type) {
      if (nodeId && type) {
        this.state.pendingImageTarget = { nodeId, type };
        this.state.selectedClassId = null;
        this.state.selectedProductId = null;
        this.state.selectedAnnotationIds = [];
      } else {
        this.state.pendingImageTarget = null;
      }
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("state:changed", this.state);
    }

    selectAnnotations(annotationIds) {
      this.state.selectedAnnotationIds = Array.isArray(annotationIds) ? [...annotationIds] : (annotationIds ? [annotationIds] : []);
      if (this.state.selectedAnnotationIds.length > 0) {
        this.state.pendingImageTarget = null;
      }
      this.emit("selection:changed", this.getSelectionSummary());
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("state:changed", this.state);
    }

    getPageAnnotations(pageNumber = this.state.currentPage) {
      return this.state.annotations[String(pageNumber)] || [];
    }

    getPageAnnotationsForCanvas(pageNumber = this.state.currentPage) {
      return this.getPageAnnotations(pageNumber).map(annotation => ({
        ...annotation,
        bbox: this.denormalizeBbox(pageNumber, annotation.bbox),
        normalizedBbox: annotation.bbox
      }));
    }

    getAnnotationForCanvasById(annotationId, pageNumber = this.state.currentPage) {
      return this.getPageAnnotationsForCanvas(pageNumber).find(item => item.id === annotationId) || null;
    }

    addAnnotation(pixelBbox) {
      const classId = this.state.selectedClassId;
      if (!classId) return null;

      const annotation = {
        id: `ann_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        classId,
        productId: this.state.selectedProductId, // 子が選ばれていれば入る、なければnull
        page: this.state.currentPage,
        bbox: this.normalizeBbox(this.state.currentPage, pixelBbox),
        coordinateSystem: "normalized_page",
        createdAt: new Date().toISOString()
      };

      const key = String(this.state.currentPage);
      if (!this.state.annotations[key]) this.state.annotations[key] = [];
      this.state.annotations[key].push(annotation);
      this.commit();
      this.emit("annotations:changed", this.getPageAnnotations());
      return annotation;
    }

    updateAnnotation(annotationId, pixelBbox) {
      const target = this.getPageAnnotations().find(item => item.id === annotationId);
      if (!target) return false;
      target.bbox = this.normalizeBbox(this.state.currentPage, pixelBbox);
      target.coordinateSystem = "normalized_page";
      this.commit();
      this.emit("annotations:changed", this.getPageAnnotations());
      return true;
    }

    updateAnnotationsLabels(annotationIds, classId, productId) {
      const key = String(this.state.currentPage);
      let changed = false;
      (this.state.annotations[key] || []).forEach(item => {
        if (annotationIds.includes(item.id)) {
          item.classId = classId;
          item.productId = productId;
          changed = true;
        }
      });
      if (changed) {
        this.commit();
        this.emit("annotations:changed", this.getPageAnnotations());
        this.emit("selection:changed", this.getSelectionSummary());
      }
      return changed;
    }

    removeSelectedAnnotations() {
      const ids = this.state.selectedAnnotationIds;
      if (!ids || ids.length === 0) return false;
      return this.removeAnnotations(ids);
    }

    removeAnnotations(annotationIds) {
      const key = String(this.state.currentPage);
      const before = this.state.annotations[key] || [];
      const after = before.filter(item => !annotationIds.includes(item.id));
      if (after.length === before.length) return false;
      this.state.annotations[key] = after;
      
      // 選択状態からも削除
      this.state.selectedAnnotationIds = this.state.selectedAnnotationIds.filter(id => !annotationIds.includes(id));
      
      this.commit();
      this.emit("annotations:changed", this.getPageAnnotations());
      this.emit("selection:changed", this.getSelectionSummary());
      return true;
    }

    getSelectionSummary() {
      const selectedClass = this.state.selectedClassId ? this.findNode(this.state.selectedClassId) : null;
      const selectedProduct = this.state.selectedProductId ? this.findNode(this.state.selectedProductId) : null;
      const pendingImageTarget = this.state.pendingImageTarget;
      
      const selectedAnnotations = this.getPageAnnotations().filter(item => this.state.selectedAnnotationIds.includes(item.id));

      return {
        selectedClass,
        selectedProduct,
        pendingImageTarget,
        selectedAnnotations
      };
    }

    getStats() {
      const annotationCount = Object.values(this.state.annotations).reduce((sum, list) => sum + list.length, 0);
      let legendCount = 0;
      let appearanceCount = 0;
      this.state.catalog.forEach(cls => {
        if (cls.legendImage) legendCount++;
        cls.products.forEach(prod => {
          if (prod.appearanceImage) appearanceCount++;
        });
      });
      return {
        annotationCount,
        legendCount,
        appearanceCount
      };
    }

    exportStateJSON() {
      const { pdfBuffer, ...serializable } = this.state;
      return JSON.stringify(serializable, null, 2);
    }

    exportDatasetJSON() {
      const state = this.state;
      // ZIP出力時の annotations.json には catalog ツリーそのものを書き出す。
      // なお、画像データ(base64)は巨大なので exportData からは削除し、別の場所(ZIP内ファイル)で書き出す
      const exportCatalog = deepClone(state.catalog).map(cls => {
        delete cls.legendImage;
        cls.products = cls.products.map(p => {
          delete p.appearanceImage;
          return p;
        });
        return cls;
      });

      const exportData = {
        schema: "symbol-annotator-dataset-v2",
        exportedAt: new Date().toISOString(),
        coordinateSystem: {
          type: "normalized_page",
          bboxFormat: "[x_ratio, y_ratio, width_ratio, height_ratio]",
          range: "0.0-1.0 relative to each rendered page width/height"
        },
        project: {
          filename: state.project.filename,
          pageCount: state.project.pageCount,
          pageDimensions: state.project.pageDimensions,
          renderScale: state.pdfRenderScale
        },
        catalog: exportCatalog,
        annotations: deepClone(state.annotations)
      };
      return JSON.stringify(exportData, null, 2);
    }

    restoreSerializedState(serialized) {
      const restored = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
      const pdfBuffer = this.state.pdfBuffer;
      this.state = {
        ...createInitialState(),
        ...restored,
        pdfBuffer
      };
      
      // 未定義のプロパティを保護
      if (!this.state.catalog) this.state.catalog = [];

      this.state.selectedClassId = null;
      this.state.selectedProductId = null;
      this.state.pendingImageTarget = null;
      this.state.selectedAnnotationIds = [];
      this.resetHistory();
      this.emitAll();
    }
  }

  NS.Store = Store;
})(window.SymbolAnnotator);