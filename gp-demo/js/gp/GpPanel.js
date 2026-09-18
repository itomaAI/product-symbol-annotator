window.SymbolAnnotator = window.SymbolAnnotator || {};

// GP 提案の UI。元ツールのクラス（Store / CanvasWorkspace）は書き換えず、ここから拡張する。
//  - 選択中クラスの bbox ＝ 正例、他クラスの bbox と「✗ 却下」＝ 負例。ページを跨いで、特徴を読み込み済みのページの bbox を全部使う
//  - 候補は点線の箱で出し、✓ で bbox に、✗ で負例に。「すべて承認 → 再計算」で 1 巡
//  - 特徴マップは data/pNN/ に同梱した 8 ページ分だけ（それ以外のページでは提案できない）
(function(NS) {
  "use strict";

  const E = NS.GpEngine;
  const DATA_URL = "data/";
  const START_PAGE = 18;
  const MAX_POS = 80;
  const MAX_NEG = 80;
  const MAX_CANDIDATES = 40;

  // === Store の拡張 ===
  NS.Store.prototype.gpNegatives = function(page, classId) {
    const all = this.state.gpNegatives || {};
    return (all[String(page)] || {})[classId] || [];
  };
  NS.Store.prototype.gpAddNegative = function(page, classId, normBbox) {
    if (!this.state.gpNegatives) this.state.gpNegatives = {};
    const key = String(page);
    if (!this.state.gpNegatives[key]) this.state.gpNegatives[key] = {};
    if (!this.state.gpNegatives[key][classId]) this.state.gpNegatives[key][classId] = [];
    this.state.gpNegatives[key][classId].push(normBbox.map(v => Math.round(v * 1e8) / 1e8));
    this.touch();
  };
  NS.Store.prototype.gpClearNegatives = function(page, classId) {
    const all = this.state.gpNegatives || {};
    if (all[String(page)] && all[String(page)][classId]) {
      delete all[String(page)][classId];
      this.touch();
    }
  };
  // addAnnotation は選択中クラス＋描画中ページ＋画素座標を前提にしているので、クラス・ページ・正規化座標を明示する版
  NS.Store.prototype.gpAddAnnotation = function(classId, productId, page, normBbox) {
    const annotation = {
      id: `ann_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      classId,
      productId: productId || null,
      page,
      bbox: normBbox.map(v => Math.round(v * 1e8) / 1e8),
      coordinateSystem: "normalized_page",
      createdAt: new Date().toISOString(),
      source: "gp"
    };
    const key = String(page);
    if (!this.state.annotations[key]) this.state.annotations[key] = [];
    this.state.annotations[key].push(annotation);
    this.commit();
    this.emit("annotations:changed", this.getPageAnnotations());
    return annotation;
  };

  class GpPanel {
    constructor({ store, canvasWorkspace, pdfService, toast }) {
      this.store = store;
      this.cw = canvasWorkspace;
      this.pdfService = pdfService;
      this.toast = toast;
      this.features = new E.GpFeatureStore(DATA_URL);

      this.proposals = [];       // [{ classId, score, bbox(正規化) }]。表示中ページのぶんだけ
      this.proposalPage = null;
      this.lastRun = null;       // { page, classIds, best, bestCls, sizes, exclude, support }
      this.busy = false;
      this.rounds = 0;
      this.approved = 0;
      this.rejected = 0;
      this.overlayNodes = [];

      this.el = {
        status: document.getElementById("gp-page-status"),
        threshold: document.getElementById("gp-threshold"),
        thresholdLabel: document.getElementById("gp-threshold-label"),
        propose: document.getElementById("gp-propose-btn"),
        proposeAll: document.getElementById("gp-propose-all-btn"),
        approveAll: document.getElementById("gp-approve-all-btn"),
        clear: document.getElementById("gp-clear-btn"),
        summary: document.getElementById("gp-summary"),
        overlay: document.getElementById("gp-overlay")
      };

      this.bind();
      this.patchWorkspace();
      this.bindStore();
      this.renderPanel();
    }

    // === 起動: 同梱 PDF を読む → 特徴の一覧を読む ===
    async start() {
      try {
        const list = await this.features.init();
        this.setStatus(`特徴あり: p${list.map(p => p.page).join(", p")}`);
      } catch (error) {
        console.error(error);
        this.setStatus(`特徴の一覧を読めません: ${error.message}`);
      }
      try {
        const res = await fetch(DATA_URL + "source.pdf");
        if (!res.ok) throw new Error(`source.pdf: HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        this.store.resetProject();
        const info = await this.pdfService.loadFromBuffer(buffer);
        this.store.setPdfBuffer(buffer);
        this.store.setProjectInfo({ filename: "source.pdf", pageCount: info.pageCount });
        this.store.setCurrentPage(this.features.has(START_PAGE) ? START_PAGE : 1);
        await this.cw.renderCurrentPage({ fit: true });
        this.toast.success(`同梱の PDF を読み込みました（${info.pageCount} ページ）。`);
      } catch (error) {
        console.error(error);
        this.toast.error(`同梱 PDF の読み込みに失敗しました: ${error.message}`);
      }
      this.onPageChanged();
    }

    bind() {
      this.el.threshold.addEventListener("input", () => {
        this.el.thresholdLabel.textContent = this.threshold().toFixed(2);
        this.rethreshold();
      });
      this.el.propose.addEventListener("click", () => this.proposeSelected());
      this.el.proposeAll.addEventListener("click", () => this.proposeAllClasses());
      this.el.approveAll.addEventListener("click", () => this.approveAll());
      this.el.clear.addEventListener("click", () => this.clearProposals());
    }

    bindStore() {
      this.store.on("page:changed", () => this.onPageChanged());
      this.store.on("selection:changed", () => this.renderPanel());
      this.store.on("catalog:changed", () => this.renderPanel());
      this.store.on("annotations:changed", () => this.renderPanel());
    }

    // 注釈の描画のあとに候補を重ねる（元の描画はそのまま）
    patchWorkspace() {
      const orig = this.cw.redrawAnnotations.bind(this.cw);
      this.cw.redrawAnnotations = skipId => {
        orig(skipId);
        this.drawProposals();
      };
    }

    threshold() { return parseFloat(this.el.threshold.value); }
    currentPage() { return this.store.getState().currentPage; }
    setStatus(text) { this.el.status.textContent = text; }

    onPageChanged() {
      const page = this.currentPage();
      if (this.lastRun && this.lastRun.page !== page) {
        // 別のページへ移ったら前の計算は捨てる（閾値スライダが古い結果を出さないように）
        this.proposals = [];
        this.proposalPage = null;
        this.lastRun = null;
        this.cw.scheduleRedraw();
      }
      this.renderPanel();
      if (this.features.has(page) && !this.features.get(page)) {
        // 先読みしておく（ボタンを押したとき待たせない）
        this.ensureFeatures(page).catch(() => {});
      }
    }

    async ensureFeatures(page) {
      if (!this.features.has(page)) return null;
      const cached = this.features.get(page);
      if (cached) return cached;
      const entry = this.features.byPage.get(page);
      this.setStatus(`p${page} の特徴を読み込み中…（${(entry.cells * 133 / 1e6).toFixed(0)} MB）`);
      try {
        const fp = await this.features.load(page);
        this.renderPanel();
        return fp;
      } catch (error) {
        console.error(error);
        this.setStatus(`p${page} の特徴を読めません: ${error.message}`);
        throw error;
      }
    }

    // === 支持点を集める ===
    // 特徴を読み込み済みの全ページから、classId の bbox を正例、他クラスの bbox と却下を負例にする
    collectSupport(classId, currentPage) {
      const state = this.store.getState();
      const pos = [], negOther = [], negRejected = [], exclude = [];
      let sw = 0, sh = 0, sn = 0;
      for (const page of this.features.loadedPages()) {
        const fp = this.features.get(page);
        const anns = state.annotations[String(page)] || [];
        for (const a of anns) {
          const b = a.bbox;
          if (!Array.isArray(b) || b.some(v => Math.abs(v) > 1)) continue; // 画素座標の古い形式は使わない
          const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
          if (page === currentPage) exclude.push({ cx, cy, classId: a.classId });
          const v = fp.vecAtNorm(cx, cy);
          if (!v) continue;
          if (a.classId === classId) {
            pos.push({ x: v, y: 1 });
            sw += b[2]; sh += b[3]; sn++;
          } else {
            negOther.push({ x: v, y: 0 });
          }
        }
        for (const b of this.store.gpNegatives(page, classId)) {
          const cx = b[0] + b[2] / 2, cy = b[1] + b[3] / 2;
          if (page === currentPage) exclude.push({ cx, cy, classId });
          const v = fp.vecAtNorm(cx, cy);
          if (v) negRejected.push({ x: v, y: 0 });
        }
      }
      const thin = (arr, max) => {
        if (arr.length <= max) return arr;
        const out = [];
        for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * arr.length / max)]);
        return out;
      };
      const size = sn > 0 ? { w: sw / sn, h: sh / sn } : null;
      return {
        pos: thin(pos, MAX_POS),
        neg: thin(negRejected.concat(negOther), MAX_NEG),
        counts: { pos: pos.length, negOther: negOther.length, negRejected: negRejected.length },
        size,
        exclude
      };
    }

    classesWithBoxes() {
      const state = this.store.getState();
      const ids = new Set();
      for (const page of this.features.loadedPages()) {
        for (const a of state.annotations[String(page)] || []) ids.add(a.classId);
      }
      return state.catalog.filter(c => ids.has(c.id)).map(c => c.id);
    }

    // === 提案 ===
    async proposeSelected() {
      const classId = this.store.getState().selectedClassId;
      if (!classId) { this.toast.error("先にサイドバーでクラスを選んでください。"); return; }
      await this.run([classId]);
    }

    async proposeAllClasses() {
      const page = this.currentPage();
      if (!(await this.prepare(page))) return;
      const ids = this.classesWithBoxes();
      if (ids.length === 0) { this.toast.error("bbox のあるクラスがまだありません。"); return; }
      await this.run(ids);
    }

    async prepare(page) {
      if (this.busy) return false;
      if (this.store.getState().project.filename !== "source.pdf") {
        this.toast.error("特徴マップは同梱の source.pdf の分しかありません。別の PDF では提案できません。");
        return false;
      }
      if (!this.features.has(page)) {
        this.toast.error(`p${page} には特徴がありません。提案できるのは p${this.features.pages.map(p => p.page).join(", p")} です。`);
        return false;
      }
      try { await this.ensureFeatures(page); } catch (_) { return false; }
      return true;
    }

    async run(classIds) {
      const page = this.currentPage();
      if (!(await this.prepare(page))) return;
      const fp = this.features.get(page);
      const state = this.store.getState();
      this.busy = true;
      this.renderPanel();
      this.setStatus("計算中…");
      // 状態表示を描かせてから同期計算に入る
      await new Promise(resolve => setTimeout(resolve, 0));
      const t0 = performance.now();
      try {
        const best = new Float32Array(fp.N);
        const bestCls = new Int16Array(fp.N).fill(-1);
        const sizes = {};
        const support = {};
        let exclude = null;
        const ran = [];
        classIds.forEach((classId, ci) => {
          const s = this.collectSupport(classId, page);
          if (s.pos.length === 0) return;
          if (!exclude) exclude = s.exclude;
          sizes[classId] = s.size;
          support[classId] = s.counts;
          const model = E.fitGP(s.pos.concat(s.neg), fp.meta.kernel);
          const post = E.scorePage(model, fp);
          for (let i = 0; i < fp.N; i++) {
            if (post[i] > best[i]) { best[i] = post[i]; bestCls[i] = ci; }
          }
          ran.push(classId);
        });
        if (ran.length === 0) {
          const name = classIds.length === 1 ? (this.store.findNode(classIds[0])?.name || classIds[0]) : "対象クラス";
          this.toast.error(`「${name}」の bbox がまだありません。特徴のあるページに 1 つ以上描いてから提案してください。`);
          this.setStatus("");
          return;
        }
        this.lastRun = { page, classIds, best, bestCls, sizes, exclude: exclude || [], support, ran: ran.length, ms: performance.now() - t0 };
        this.proposalPage = page;
        this.proposals = this.pickProposals();
        this.cw.scheduleRedraw();
      } catch (error) {
        console.error(error);
        this.toast.error(`GP の計算に失敗しました: ${error.message}`);
        this.setStatus("");
      } finally {
        this.busy = false;
        this.renderPanel();
      }
    }

    pickProposals() {
      const r = this.lastRun;
      const fp = this.features.get(r.page);
      const th = this.threshold();
      const points = [];
      for (let i = 0; i < fp.N; i++) {
        if (r.best[i] > th) points.push({ score: r.best[i], i, classId: r.classIds[r.bestCls[i]] });
      }
      return E.propose(fp, points, th, r.sizes, r.exclude, MAX_CANDIDATES);
    }

    rethreshold() {
      if (!this.lastRun || this.lastRun.page !== this.currentPage()) return;
      this.proposals = this.pickProposals();
      this.cw.scheduleRedraw();
      this.renderPanel();
    }

    clearProposals() {
      this.proposals = [];
      this.proposalPage = null;
      this.cw.scheduleRedraw();
      this.renderPanel();
    }

    approve(index) {
      if (this.busy) return;
      const p = this.proposals[index];
      if (!p) return;
      const productId = this.store.getState().selectedClassId === p.classId ? this.store.getState().selectedProductId : null;
      this.store.gpAddAnnotation(p.classId, productId, this.proposalPage, p.bbox);
      this.proposals.splice(index, 1);
      this.approved++;
      this.cw.scheduleRedraw();
      this.renderPanel();
    }

    reject(index) {
      if (this.busy) return;
      const p = this.proposals[index];
      if (!p) return;
      this.store.gpAddNegative(this.proposalPage, p.classId, p.bbox);
      this.proposals.splice(index, 1);
      this.rejected++;
      this.cw.scheduleRedraw();
      this.renderPanel();
    }

    async approveAll() {
      if (this.busy || this.proposals.length === 0 || !this.lastRun) return;
      const page = this.proposalPage;
      const selected = this.store.getState().selectedClassId;
      const productId = this.store.getState().selectedProductId;
      for (const p of this.proposals) {
        this.store.gpAddAnnotation(p.classId, p.classId === selected ? productId : null, page, p.bbox);
      }
      this.approved += this.proposals.length;
      this.proposals = [];
      this.rounds++;
      await this.run(this.lastRun.classIds);
    }

    // === 描画 ===
    drawProposals() {
      const page = this.currentPage();
      const show = this.proposalPage === page && this.proposals.length > 0;
      this.syncOverlay(show);
      if (!show) return;
      const ctx = this.cw.getOverlayContext(this.cw.annotationCanvas);
      ctx.save();
      ctx.setLineDash([7, 4]);
      ctx.lineWidth = 2;
      ctx.font = "700 11px sans-serif";
      ctx.textBaseline = "top";
      this.proposals.forEach((p, i) => {
        const cls = this.store.findNode(p.classId);
        const [x, y, w, h] = this.cw.pdfRectToScreenRect(this.store.denormalizeBbox(page, p.bbox));
        ctx.strokeStyle = cls?.borderColor || "#ffa500";
        ctx.fillStyle = cls?.color || "rgba(255,165,0,0.15)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        const node = this.overlayNodes[i];
        if (node) {
          node.style.left = `${Math.round(x + w + 2)}px`;
          node.style.top = `${Math.round(y)}px`;
        }
      });
      ctx.restore();
    }

    // ✓✗ ボタン。候補の数が変わったときだけ作り直し、位置は描画のたびに動かす
    syncOverlay(show) {
      const overlay = this.el.overlay;
      if (!show) {
        if (this.overlayNodes.length) { overlay.innerHTML = ""; this.overlayNodes = []; }
        return;
      }
      if (this.overlayNodes.length === this.proposals.length && overlay.dataset.stamp === this.overlayStamp()) return;
      overlay.innerHTML = "";
      this.overlayNodes = this.proposals.map((p, i) => {
        const div = document.createElement("div");
        div.className = "gp-cand";
        const ok = document.createElement("button");
        ok.type = "button";
        ok.className = "gp-ok";
        ok.textContent = `✓ ${p.score.toFixed(2)}`;
        ok.title = `${this.store.findNode(p.classId)?.name || p.classId} として bbox に加える`;
        ok.addEventListener("mousedown", e => e.stopPropagation());
        ok.addEventListener("click", e => { e.stopPropagation(); this.approve(i); });
        const ng = document.createElement("button");
        ng.type = "button";
        ng.className = "gp-ng";
        ng.textContent = "✗";
        ng.title = "却下（このクラスの負例として覚える）";
        ng.addEventListener("mousedown", e => e.stopPropagation());
        ng.addEventListener("click", e => { e.stopPropagation(); this.reject(i); });
        div.appendChild(ok);
        div.appendChild(ng);
        overlay.appendChild(div);
        return div;
      });
      overlay.dataset.stamp = this.overlayStamp();
    }

    overlayStamp() {
      return this.proposals.map(p => `${p.classId}:${p.bbox[0].toFixed(5)},${p.bbox[1].toFixed(5)}`).join("|");
    }

    // === パネルの表示 ===
    renderPanel() {
      const state = this.store.getState();
      const page = state.currentPage;
      const cls = state.selectedClassId ? this.store.findNode(state.selectedClassId) : null;
      const hasFeat = this.features.has(page);
      const loaded = !!this.features.get(page);
      this.el.propose.disabled = this.busy || !hasFeat || !cls;
      this.el.propose.textContent = cls ? `「${cls.name}」を提案` : "選択クラスを提案";
      this.el.proposeAll.disabled = this.busy || !hasFeat;
      this.el.approveAll.disabled = this.busy || this.proposals.length === 0 || this.proposalPage !== page;
      this.el.approveAll.textContent = `表示中の ${this.proposalPage === page ? this.proposals.length : 0} 件をすべて承認 → 再計算`;
      this.el.clear.disabled = this.busy || this.proposals.length === 0;

      if (!this.busy) {
        if (!hasFeat) {
          this.setStatus(`p${page}: 特徴なし（提案できるのは p${this.features.pages.map(p => p.page).join(", p")}）`);
        } else if (loaded) {
          const fp = this.features.get(page);
          let text = `p${page}: 特徴あり（${fp.N.toLocaleString()} セル・白紙は持たない）`;
          if (this.lastRun && this.lastRun.page === page) {
            text += ` ／ 計算 ${(this.lastRun.ms / 1000).toFixed(1)} 秒（${this.lastRun.ran} クラス）`;
          }
          this.setStatus(text);
        }
      }

      const parts = [];
      if (this.lastRun && this.lastRun.page === page) {
        const s = this.lastRun.support;
        const sup = Object.keys(s).map(id => {
          const c = s[id];
          return `${this.store.findNode(id)?.name || id}: 正 ${c.pos}・負 ${c.negOther + c.negRejected}（他クラス ${c.negOther}＋却下 ${c.negRejected}）`;
        });
        parts.push(`候補 ${this.proposals.length} 件（閾値 ${this.threshold().toFixed(2)}・上限 ${MAX_CANDIDATES}）`);
        parts.push(...sup);
      }
      parts.push(`巡 ${this.rounds}／承認 ${this.approved}・却下 ${this.rejected}`);
      this.el.summary.innerHTML = parts.map(t => `<div>${t}</div>`).join("");
    }
  }

  NS.GpPanel = GpPanel;

  // App.js の DOMContentLoaded より後に登録されるので、NS.app はできている
  document.addEventListener("DOMContentLoaded", () => {
    const app = NS.app;
    if (!app) { console.error("NS.app が無い（GpPanel.js は App.js より後に読み込む）"); return; }
    app.gp = new GpPanel({ store: app.store, canvasWorkspace: app.canvasWorkspace, pdfService: app.pdfService, toast: app.toast });
    app.gp.start();
  });
})(window.SymbolAnnotator);
