window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class CanvasWorkspace {
    constructor({ store, pdfService, toast }) {
      this.store = store;
      this.pdfService = pdfService;
      this.toast = toast;

      this.viewport = document.getElementById("viewport");
      this.stack = document.getElementById("canvas-stack");
      this.pdfCanvas = document.getElementById("pdf-canvas");
      this.annotationCanvas = document.getElementById("annotation-canvas");
      this.interactionCanvas = document.getElementById("interaction-canvas");

      this.viewScale = 1;
      this.tx = 40;
      this.ty = 40;

      this.spacePressed = false;
      this.isPanning = false;
      this.isDrawing = false;
      this.isMoving = false;
      this.isResizing = false;
      this.isLassoing = false; // 範囲選択モード

      this.startScreen = { x: 0, y: 0 };
      this.startCanvas = { x: 0, y: 0 };
      this.startTranslate = { x: 0, y: 0 };
      this.targetAnnotationId = null;
      this.originalBbox = null;
      this.resizeHandle = null;

      this.rafPending = false;
      this.pendingSkipId = null;

      this.bindEvents();
      this.bindStore();
      this.resizeOverlayCanvases();
      this.applyTransform();
    }

    bindEvents() {
      this.viewport.addEventListener("mousedown", event => this.onMouseDown(event));
      window.addEventListener("mousemove", event => this.onMouseMove(event));
      window.addEventListener("mouseup", event => this.onMouseUp(event));
      this.viewport.addEventListener("wheel", event => this.onWheel(event), { passive: false });
      this.viewport.addEventListener("contextmenu", event => {
        event.preventDefault();
        
        const point = this.canvasPoint(event);
        const hitId = this.findHitAnnotation(point.x, point.y);
        const state = this.store.getState();
        
        // 描画モード（クラス選択中）や切り抜きモードなら解除する
        if (state.selectedClassId || state.pendingImageTarget) {
          this.store.selectNode(null);
          this.store.setPendingImageTarget(null);
        }

        const isHitInSelection = hitId && state.selectedAnnotationIds.includes(hitId);
        
        if (isHitInSelection) {
          // 既に選択されているものの上なら、そのままメニューを出す（複数選択維持）
          this.showContextMenu(event.clientX, event.clientY);
        } else if (hitId) {
          // 未選択のBBoxの上なら、それを単一選択にしてメニューを出す
          this.store.selectAnnotations([hitId]);
          this.showContextMenu(event.clientX, event.clientY);
        } else if (state.selectedAnnotationIds.length > 0) {
          // 何もない場所だが、既に何か選択されている場合、そのままメニューを出す（複数選択維持）
          this.showContextMenu(event.clientX, event.clientY);
        } else {
          // 何も選択されておらず、何もない場所ならクリア
          this.store.selectAnnotations([]);
          this.hideContextMenu();
        }
      });
      
      // 他の場所をクリックしたらメニューを消す
      document.addEventListener("click", () => this.hideContextMenu());

      window.addEventListener("resize", () => {
        this.resizeOverlayCanvases();
        this.scheduleRedraw();
      });

      window.addEventListener("keydown", event => {
        if (event.code === "Space" && !this.isTextInput(event.target)) {
          event.preventDefault();
          this.spacePressed = true;
          this.updateCursor();
        }
      });

      window.addEventListener("keyup", event => {
        if (event.code === "Space") {
          this.spacePressed = false;
          this.updateCursor();
        }
      });
    }

    bindStore() {
      this.store.on("annotations:changed", () => this.scheduleRedraw());
      this.store.on("selection:changed", () => {
        this.scheduleRedraw();
        this.updateCursor();
      });
      this.store.on("page:changed", () => this.scheduleRedraw());
    }

    isTextInput(target) {
      if (!target) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
    }

    async renderCurrentPage({ fit = false } = {}) {
      const state = this.store.getState();
      if (!state.project.pageCount) return;

      this.pdfCanvas.style.opacity = "0.45";
      try {
        const dimensions = await this.pdfService.renderPage(state.currentPage, this.pdfCanvas, state.pdfRenderScale);
        if (!dimensions) return;
        this.syncPdfLayerSize(dimensions.width, dimensions.height);
        this.store.setPageDimension(state.currentPage, dimensions);
        this.resizeOverlayCanvases();
        if (fit) {
          this.fitToViewport();
        }
        this.scheduleRedraw();
      } catch (error) {
        console.error(error);
        this.toast.error(`PDFページの描画に失敗しました: ${error.message}`);
      } finally {
        this.pdfCanvas.style.opacity = "1";
      }
    }

    syncPdfLayerSize(width, height) {
      this.stack.style.width = `${width}px`;
      this.stack.style.height = `${height}px`;
    }

    resizeOverlayCanvases() {
      const width = Math.max(1, this.viewport.clientWidth);
      const height = Math.max(1, this.viewport.clientHeight);
      const dpr = Math.max(1, window.devicePixelRatio || 1);

      [this.annotationCanvas, this.interactionCanvas].forEach(canvas => {
        const targetWidth = Math.round(width * dpr);
        const targetHeight = Math.round(height * dpr);

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
    }

    getOverlayContext(canvas) {
      this.resizeOverlayCanvases();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    overlayWidth() {
      return Math.max(1, this.viewport.clientWidth);
    }

    overlayHeight() {
      return Math.max(1, this.viewport.clientHeight);
    }

    clearOverlay(canvas) {
      const ctx = this.getOverlayContext(canvas);
      ctx.clearRect(0, 0, this.overlayWidth(), this.overlayHeight());
      return ctx;
    }

    applyTransform() {
      this.stack.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.viewScale})`;
    }

    fitToViewport() {
      const vw = this.viewport.clientWidth;
      const vh = this.viewport.clientHeight;
      const cw = this.pdfCanvas.width || 1;
      const ch = this.pdfCanvas.height || 1;
      const scale = Math.max(0.08, Math.min((vw - 80) / cw, (vh - 80) / ch, 1.5));
      this.viewScale = scale;
      this.tx = Math.max(24, (vw - cw * scale) / 2);
      this.ty = Math.max(24, (vh - ch * scale) / 2);
      this.applyTransform();
      this.scheduleRedraw();
    }

    actualSize() {
      this.viewScale = 1;
      this.tx = 40;
      this.ty = 40;
      this.applyTransform();
      this.scheduleRedraw();
    }

    canvasPoint(event) {
      return NS.Geometry.screenToCanvas(event, this.stack, this.viewScale);
    }

    pdfPointToScreen(x, y) {
      return {
        x: this.tx + x * this.viewScale,
        y: this.ty + y * this.viewScale
      };
    }

    pdfRectToScreenRect(bbox) {
      const [x, y, w, h] = bbox;
      return [
        this.tx + x * this.viewScale,
        this.ty + y * this.viewScale,
        w * this.viewScale,
        h * this.viewScale
      ];
    }

    onWheel(event) {
      event.preventDefault();

      const oldScale = this.viewScale;
      const delta = event.deltaY > 0 ? 1 / NS.Config.ui.zoomStep : NS.Config.ui.zoomStep;
      const newScale = Math.max(NS.Config.ui.zoomMin, Math.min(NS.Config.ui.zoomMax, oldScale * delta));

      const rect = this.stack.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const ratio = newScale / oldScale;

      this.tx -= pointerX * (ratio - 1);
      this.ty -= pointerY * (ratio - 1);
      this.viewScale = newScale;

      this.applyTransform();
      this.scheduleRedraw();
    }

    onMouseDown(event) {
      if (event.button === 1 || (event.button === 0 && this.spacePressed)) {
        event.preventDefault();
        this.isPanning = true;
        this.startScreen = { x: event.clientX, y: event.clientY };
        this.startTranslate = { x: this.tx, y: this.ty };
        this.updateCursor();
        return;
      }

      if (event.button !== 0) return;

      const state = this.store.getState();
      const point = this.canvasPoint(event);

      // Shift押下時はラッソ（範囲選択）モード
      if (event.shiftKey) {
        this.isLassoing = true;
        this.startCanvas = point;
        this.store.selectAnnotations([]); // 新規選択開始時に一旦クリア
        this.clearInteraction();
        this.updateCursor();
        return;
      }

      const handleInfo = this.findResizeHandle(point.x, point.y);
      const hitId = this.findHitAnnotation(point.x, point.y);

      if (handleInfo) {
        this.isResizing = true;
        this.resizeHandle = handleInfo.handle;
        this.targetAnnotationId = handleInfo.annotationId;
        this.originalBbox = [...this.getAnnotationById(this.targetAnnotationId).bbox];
        this.startCanvas = point;
        this.clearInteraction();
        this.updateCursor();
        return;
      }

      if (hitId) {
        let newSelection = [...state.selectedAnnotationIds];
        const isMultiSelectModifier = event.ctrlKey || event.metaKey;

        if (isMultiSelectModifier) {
          // Ctrl/Cmd + Click: トグル選択
          if (newSelection.includes(hitId)) {
            newSelection = newSelection.filter(id => id !== hitId);
          } else {
            newSelection.push(hitId);
          }
          this.store.selectAnnotations(newSelection);
        } else {
          // 通常クリック
          if (!newSelection.includes(hitId)) {
            this.store.selectAnnotations([hitId]);
          } else if (newSelection.length > 1) {
            // 既に複数選択されていて、その中の一つを通常クリックした場合は単一選択に戻すか？
            // ユーザーが右クリックメニューを出すためにクリックした可能性もあるため、
            // 選択済みのものをもう一度左クリックした場合は、MouseUp まで単一選択への解除を遅延させるのが一般的。
            // しかし今回は簡易的に、マウス移動（ドラッグ）がなければ解除、などの制御は複雑なので
            // 「既に選択グループに含まれていれば何もしない（複数選択を維持する）」とする。
          }
        }

        // ドラッグ移動の準備
        this.isMoving = true;
        this.targetAnnotationId = hitId; // 移動対象は1つだけ
        this.originalBbox = [...this.getAnnotationById(hitId).bbox];
        this.startCanvas = point;
        this.clearInteraction();
        this.updateCursor();
        return;
      }

      if (state.pendingImageTarget || state.selectedClassId) {
        this.store.selectAnnotations([]);
        this.isDrawing = true;
        this.startCanvas = point;
        this.updateCursor();
        return;
      }

      this.store.selectAnnotations([]);
    }

    onMouseMove(event) {
      const point = this.canvasPoint(event);

      if (this.isPanning) {
        const dx = event.clientX - this.startScreen.x;
        const dy = event.clientY - this.startScreen.y;
        this.tx = this.startTranslate.x + dx;
        this.ty = this.startTranslate.y + dy;
        this.applyTransform();
        this.scheduleRedraw();
        return;
      }

      if (this.isLassoing) {
        this.drawLasso(this.startCanvas, point);
        return;
      }

      if (this.isDrawing) {
        this.drawDraft(this.startCanvas, point);
        return;
      }

      if (this.isMoving && this.targetAnnotationId) {
        const dx = point.x - this.startCanvas.x;
        const dy = point.y - this.startCanvas.y;
        const next = [
          this.originalBbox[0] + dx,
          this.originalBbox[1] + dy,
          this.originalBbox[2],
          this.originalBbox[3]
        ];
        this.drawAnnotationPreview(this.targetAnnotationId, next);
        return;
      }

      if (this.isResizing && this.targetAnnotationId) {
        this.drawAnnotationPreview(this.targetAnnotationId, this.computeResizedBbox(point));
        return;
      }

      this.updateCursorForHover(point);
    }

    onMouseUp(event) {
      if (this.isPanning) {
        this.isPanning = false;
        this.updateCursor();
        return;
      }

      const point = this.canvasPoint(event);

      if (this.isLassoing) {
        this.isLassoing = false;
        this.clearInteraction();
        const lassoBbox = NS.Geometry.normalizeRect(this.startCanvas.x, this.startCanvas.y, point.x, point.y);
        
        // 交差判定
        const selectedIds = [];
        const annotations = this.store.getPageAnnotationsForCanvas();
        for (const ann of annotations) {
          if (NS.Geometry.rectIntersect(lassoBbox, ann.bbox)) {
            selectedIds.push(ann.id);
          }
        }
        this.store.selectAnnotations(selectedIds);
        this.updateCursor();
        return;
      }

      if (this.isDrawing) {
        this.isDrawing = false;
        this.clearInteraction();
        const bbox = NS.Geometry.normalizeRect(this.startCanvas.x, this.startCanvas.y, point.x, point.y);
        if (bbox[2] < NS.Config.minBoxSize || bbox[3] < NS.Config.minBoxSize) {
          if (this.store.getState().pendingImageTarget) {
            this.store.setPendingImageTarget(null);
          }
          this.updateCursor();
          return;
        }

        const state = this.store.getState();
        if (state.pendingImageTarget) {
          const image = this.pdfService.cropCanvas(this.pdfCanvas, bbox);
          this.store.setCatalogImage(state.pendingImageTarget.nodeId, state.pendingImageTarget.type, image);
        } else if (state.selectedClassId) {
          this.store.addAnnotation(bbox);
        }
        this.updateCursor();
        return;
      }

      if (this.isMoving && this.targetAnnotationId) {
        this.isMoving = false;
        this.clearInteraction();
        const dx = point.x - this.startCanvas.x;
        const dy = point.y - this.startCanvas.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const bbox = [
            this.originalBbox[0] + dx,
            this.originalBbox[1] + dy,
            this.originalBbox[2],
            this.originalBbox[3]
          ];
          this.store.updateAnnotation(this.targetAnnotationId, bbox);
        } else {
          this.scheduleRedraw();
        }
        this.targetAnnotationId = null;
        this.updateCursor();
        return;
      }

      if (this.isResizing && this.targetAnnotationId) {
        this.isResizing = false;
        this.clearInteraction();
        const bbox = this.computeResizedBbox(point);
        this.store.updateAnnotation(this.targetAnnotationId, bbox);
        this.targetAnnotationId = null;
        this.resizeHandle = null;
        this.updateCursor();
      }
    }

    computeResizedBbox(point) {
      const dx = point.x - this.startCanvas.x;
      const dy = point.y - this.startCanvas.y;
      let [x, y, w, h] = this.originalBbox;

      if (this.resizeHandle === "tl") {
        x += dx; y += dy; w -= dx; h -= dy;
      } else if (this.resizeHandle === "tr") {
        y += dy; w += dx; h -= dy;
      } else if (this.resizeHandle === "bl") {
        x += dx; w -= dx; h += dy;
      } else if (this.resizeHandle === "br") {
        w += dx; h += dy;
      }

      if (w < NS.Config.minBoxSize) {
        if (this.resizeHandle === "tl" || this.resizeHandle === "bl") x = this.originalBbox[0] + this.originalBbox[2] - NS.Config.minBoxSize;
        w = NS.Config.minBoxSize;
      }
      if (h < NS.Config.minBoxSize) {
        if (this.resizeHandle === "tl" || this.resizeHandle === "tr") y = this.originalBbox[1] + this.originalBbox[3] - NS.Config.minBoxSize;
        h = NS.Config.minBoxSize;
      }

      return [x, y, w, h];
    }

    getAnnotationById(id) {
      return this.store.getAnnotationForCanvasById(id) || null;
    }

    findHitAnnotation(x, y) {
      const annotations = this.store.getPageAnnotationsForCanvas();
      for (let i = annotations.length - 1; i >= 0; i--) {
        if (NS.Geometry.pointInRect(x, y, annotations[i].bbox)) {
          return annotations[i].id;
        }
      }
      return null;
    }

    getHandles(bbox) {
      const [x, y, w, h] = bbox;
      const size = NS.Config.ui.handleScreenSize / this.viewScale;
      const half = size / 2;
      return {
        tl: [x - half, y - half, size, size],
        tr: [x + w - half, y - half, size, size],
        bl: [x - half, y + h - half, size, size],
        br: [x + w - half, y + h - half, size, size]
      };
    }

    getScreenHandles(bbox) {
      const [x, y, w, h] = this.pdfRectToScreenRect(bbox);
      const size = NS.Config.ui.handleScreenSize;
      const half = size / 2;
      return {
        tl: [x - half, y - half, size, size],
        tr: [x + w - half, y - half, size, size],
        bl: [x - half, y + h - half, size, size],
        br: [x + w - half, y + h - half, size, size]
      };
    }

    findResizeHandle(x, y) {
      const state = this.store.getState();
      if (!state.selectedAnnotationIds || state.selectedAnnotationIds.length !== 1) return null;
      const targetId = state.selectedAnnotationIds[0];
      const selected = this.getAnnotationById(targetId);
      if (!selected) return null;
      const handles = this.getHandles(selected.bbox);
      for (const [name, rect] of Object.entries(handles)) {
        if (NS.Geometry.pointInRect(x, y, rect)) {
          return { handle: name, annotationId: targetId };
        }
      }
      return null;
    }

    scheduleRedraw(skipId = null) {
      this.pendingSkipId = skipId;
      if (this.rafPending) return;
      this.rafPending = true;
      requestAnimationFrame(() => {
        this.rafPending = false;
        this.redrawAnnotations(this.pendingSkipId);
        this.pendingSkipId = null;
      });
    }

    redrawAnnotations(skipId = null) {
      const ctx = this.clearOverlay(this.annotationCanvas);
      const state = this.store.getState();
      const annotations = this.store.getPageAnnotationsForCanvas();

      annotations.forEach(annotation => {
        if (annotation.id === skipId) return;
        this.drawAnnotation(ctx, annotation, {
          selected: state.selectedAnnotationIds.includes(annotation.id)
        });
      });
    }

    showContextMenu(clientX, clientY) {
      this.hideContextMenu();
      
      const menu = document.createElement("div");
      menu.id = "canvas-context-menu";
      menu.className = "context-menu";
      menu.style.left = `${clientX}px`;
      menu.style.top = `${clientY}px`;
      
      const editBtn = document.createElement("button");
      editBtn.className = "context-menu-item";
      editBtn.innerHTML = "✎ ラベルを一括編集";
      editBtn.onclick = () => {
        this.hideContextMenu();
        if (NS.app && NS.app.batchEditor) {
          NS.app.batchEditor.open();
        }
      };
      
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "context-menu-item danger";
      deleteBtn.innerHTML = "🗑️ 削除";
      deleteBtn.onclick = () => {
        this.hideContextMenu();
        this.store.removeSelectedAnnotations();
      };
      
      menu.appendChild(editBtn);
      menu.appendChild(deleteBtn);
      document.body.appendChild(menu);
    }

    hideContextMenu() {
      const existing = document.getElementById("canvas-context-menu");
      if (existing) {
        existing.remove();
      }
    }

    drawAnnotation(ctx, annotation, options = {}) {
      const classDef = this.store.findNode(annotation.classId);
      const productDef = annotation.productId ? this.store.findNode(annotation.productId) : null;
      const [x, y, w, h] = this.pdfRectToScreenRect(annotation.bbox);
      const lineWidth = 2;

      ctx.save();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = classDef?.borderColor || "#ffffff";
      ctx.fillStyle = classDef?.color || "rgba(255,255,255,0.16)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      const labelClass = classDef?.name || annotation.classId;
      const labelProduct = productDef?.name || null;

      let lines = [];
      if (options.selected) {
        // 選択時は親と子で改行するが、文字数での折り返しはしない
        lines.push(labelClass);
        if (labelProduct) {
          lines.push("> " + labelProduct);
        }
      } else {
        // 非選択時はコンパクトに省略表示
        let shortText = labelProduct ? `${labelClass} > ${labelProduct}` : labelClass;
        if (shortText.length > 10) {
          shortText = shortText.substring(0, 9) + "…";
        }
        lines.push(shortText);
      }

      ctx.font = "700 11px sans-serif";
      ctx.textBaseline = "middle";

      const lineHeight = 15;
      const paddingX = 4;
      const paddingY = 2;
      const totalH = (lines.length * lineHeight) + (paddingY * 2);

      let maxW = 0;
      lines.forEach(text => {
        const tw = ctx.measureText(text).width;
        if (tw > maxW) maxW = tw;
      });
      const totalW = Math.ceil(maxW) + (paddingX * 2);

      const labelY = y - totalH >= 2 ? y - totalH : y;

      ctx.fillStyle = classDef?.borderColor || "#ffffff";
      ctx.fillRect(x, labelY, totalW, totalH);

      ctx.fillStyle = "#071018";
      lines.forEach((text, i) => {
        ctx.fillText(text, x + paddingX, labelY + paddingY + (i * lineHeight) + (lineHeight / 2));
      });

      if (options.selected) {
        ctx.strokeStyle = "#ffe66d";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);

        const handles = this.getScreenHandles(annotation.bbox);
        Object.values(handles).forEach(rect => {
          ctx.fillStyle = "#fff8c6";
          ctx.strokeStyle = "#111111";
          ctx.lineWidth = 1;
          ctx.fillRect(...rect);
          ctx.strokeRect(...rect);
        });
      }

      ctx.restore();
    }

    clearInteraction() {
      this.clearOverlay(this.interactionCanvas);
    }

    drawDraft(start, current) {
      const ctx = this.clearOverlay(this.interactionCanvas);

      const state = this.store.getState();
      const bbox = NS.Geometry.normalizeRect(start.x, start.y, current.x, current.y);
      const screenBbox = this.pdfRectToScreenRect(bbox);
      const isLegend = !!state.pendingImageTarget;
      const classDef = this.store.findNode(state.selectedClassId);

      ctx.save();
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = isLegend ? "#e879f9" : classDef?.borderColor || "#ffffff";
      ctx.fillStyle = isLegend ? "rgba(232, 121, 249, 0.16)" : classDef?.color || "rgba(255,255,255,0.12)";
      ctx.fillRect(...screenBbox);
      ctx.strokeRect(...screenBbox);
      ctx.restore();
    }

    drawLasso(start, current) {
      const ctx = this.clearOverlay(this.interactionCanvas);
      const bbox = NS.Geometry.normalizeRect(start.x, start.y, current.x, current.y);
      const screenBbox = this.pdfRectToScreenRect(bbox);

      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#408cff";
      ctx.fillStyle = "rgba(64, 140, 255, 0.15)";
      ctx.fillRect(...screenBbox);
      ctx.strokeRect(...screenBbox);
      ctx.restore();
    }

    drawAnnotationPreview(skipId, bbox) {
      this.scheduleRedraw(skipId);
      const ctx = this.clearOverlay(this.interactionCanvas);
      const screenBbox = this.pdfRectToScreenRect(bbox);

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffe66d";
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(...screenBbox);
      ctx.restore();
    }

    updateCursorForHover(point) {
      const handleInfo = this.findResizeHandle(point.x, point.y);
      const hitId = this.findHitAnnotation(point.x, point.y);

      if (handleInfo) {
        this.viewport.style.cursor = (handleInfo.handle === "tl" || handleInfo.handle === "br") ? "nwse-resize" : "nesw-resize";
      } else if (hitId) {
        this.viewport.style.cursor = "move";
      } else {
        this.updateCursor();
      }
    }

    updateCursor() {
      this.viewport.classList.toggle("is-pan-ready", this.spacePressed);
      this.viewport.classList.toggle("is-panning", this.isPanning);
      const state = this.store.getState();
      const drawing = !!state.selectedClassId || !!state.pendingImageTarget || this.isDrawing;
      this.viewport.classList.toggle("is-drawing", drawing && !this.spacePressed && !this.isPanning);

      if (this.isPanning) {
        this.viewport.style.cursor = "grabbing";
      } else if (this.spacePressed) {
        this.viewport.style.cursor = "grab";
      } else if (drawing) {
        this.viewport.style.cursor = "crosshair";
      } else {
        this.viewport.style.cursor = "default";
      }
    }
  }

  NS.CanvasWorkspace = CanvasWorkspace;
})(window.SymbolAnnotator);