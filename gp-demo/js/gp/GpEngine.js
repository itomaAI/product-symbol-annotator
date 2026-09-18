window.SymbolAnnotator = window.SymbolAnnotator || {};

// GP 提案の計算部（UI を持たない）。
// 特徴マップは precompute_pages.py（auto-sekisan/demo/annot_demo）が書いた「インク近傍のセルだけ・int8」の疎な形:
//   meta.json  … {width,height,stride,featureWidth,featureHeight,channels,cells,kernel{lengthscale,outA,outB}}
//   cells.bin  … uint32[N]  セル index（row*featureWidth+col、昇順）
//   feat.bin   … int8[N*C]  量子化した埋め込み（セルごとのスケールを掛けると L2 正規化済みの z に戻る）
//   scale.bin  … float32[N] セルごとのスケール
// GP そのものは sekisan-gp-demo の app.js と同じ（学習カーネル: RBF・lengthscale 固定・事後平均をロジット a*m+b の sigmoid に通す）。
(function(NS) {
  "use strict";

  const NOISE = 1e-2;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  class GpFeatures {
    constructor(meta, cells, feat, scale) {
      this.meta = meta;
      this.cells = cells;
      this.feat = feat;
      this.scale = scale;
      this.N = cells.length;
      this.C = meta.channels;
      // セル index → 疎配列の位置（無いセルは -1 = 白紙）
      this.pos = new Int32Array(meta.featureWidth * meta.featureHeight).fill(-1);
      for (let i = 0; i < this.N; i++) this.pos[cells[i]] = i;
    }

    // 正規化座標 (0..1) → セルの row/col
    cellRC(nx, ny) {
      const m = this.meta;
      return {
        col: clamp(Math.round(nx * m.width / m.stride), 0, m.featureWidth - 1),
        row: clamp(Math.round(ny * m.height / m.stride), 0, m.featureHeight - 1)
      };
    }

    // 正規化座標の点の特徴ベクトル（復元済み・L2 正規化）。そのセルが白紙なら半径 radius セル以内で最も近いセルを使う。無ければ null。
    vecAtNorm(nx, ny, radius = 2) {
      const m = this.meta;
      const { row, col } = this.cellRC(nx, ny);
      let best = -1, bestD = Infinity;
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const r = row + dr, c = col + dc;
          if (r < 0 || c < 0 || r >= m.featureHeight || c >= m.featureWidth) continue;
          const idx = this.pos[r * m.featureWidth + c];
          if (idx < 0) continue;
          const d = dr * dr + dc * dc;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
      if (best < 0) return null;
      const C = this.C, v = new Float32Array(C), base = best * C, s = this.scale[best];
      for (let k = 0; k < C; k++) v[k] = this.feat[base + k] * s;
      return v;
    }
  }

  // ページごとの特徴を取りに行き、持っておく（一度読んだページは捨てない: 8 ページで最大 110 MB ほど）
  class GpFeatureStore {
    constructor(baseUrl) {
      this.baseUrl = baseUrl.replace(/\/?$/, "/");
      this.pages = [];
      this.byPage = new Map();
      this.cache = new Map();
      this.loading = new Map();
    }

    async init() {
      const res = await fetch(this.baseUrl + "pages.json");
      if (!res.ok) throw new Error(`pages.json: HTTP ${res.status}`);
      this.pages = await res.json();
      this.byPage = new Map(this.pages.map(p => [p.page, p]));
      return this.pages;
    }

    has(page) { return this.byPage.has(page); }
    get(page) { return this.cache.get(page) || null; }
    loadedPages() { return [...this.cache.keys()]; }

    async load(page, onProgress) {
      if (this.cache.has(page)) return this.cache.get(page);
      if (this.loading.has(page)) return this.loading.get(page);
      const entry = this.byPage.get(page);
      if (!entry) return null;
      const dir = this.baseUrl + entry.dir + "/";
      const fetchBuf = async name => {
        const r = await fetch(dir + name);
        if (!r.ok) throw new Error(`${entry.dir}/${name}: HTTP ${r.status}`);
        return r.arrayBuffer();
      };
      const task = (async () => {
        if (onProgress) onProgress(entry);
        const [meta, cells, feat, scale] = await Promise.all([
          fetch(dir + "meta.json").then(r => { if (!r.ok) throw new Error(`meta.json: HTTP ${r.status}`); return r.json(); }),
          fetchBuf("cells.bin").then(b => new Uint32Array(b)),
          fetchBuf("feat.bin").then(b => new Int8Array(b)),
          fetchBuf("scale.bin").then(b => new Float32Array(b))
        ]);
        const fp = new GpFeatures(meta, cells, feat, scale);
        this.cache.set(page, fp);
        this.loading.delete(page);
        return fp;
      })();
      this.loading.set(page, task);
      try {
        return await task;
      } catch (error) {
        this.loading.delete(page);
        throw error;
      }
    }
  }

  // 小さな対称正定値系 Ax=b を部分ピボット付きガウス消去で解く（A は壊す）
  function solveLinear(A, b, n) {
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      if (piv !== i) { const t = A[i]; A[i] = A[piv]; A[piv] = t; const tb = b[i]; b[i] = b[piv]; b[piv] = tb; }
      const pivVal = A[i][i] || 1e-8;
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / pivVal;
        if (f === 0) continue;
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / (A[i][i] || 1e-8);
    }
    return x;
  }

  function sqDist(a, b, C) {
    let s = 0;
    for (let k = 0; k < C; k++) { const d = a[k] - b[k]; s += d * d; }
    return s;
  }

  // support: [{ x: Float32Array(C), y: 0|1 }]
  function fitGP(support, kernel) {
    const M = support.length;
    const C = support[0].x.length;
    const ls = kernel.lengthscale;
    const twoLs2 = 2 * ls * ls;
    const A = [];
    for (let i = 0; i < M; i++) {
      A.push(new Float64Array(M));
      for (let j = 0; j < M; j++) {
        A[i][j] = Math.exp(-sqDist(support[i].x, support[j].x, C) / twoLs2) + (i === j ? NOISE : 0);
      }
    }
    const y = Float64Array.from(support, s => s.y);
    const alpha = solveLinear(A, y, M);
    return { X: support.map(s => s.x), alpha, twoLs2, kernel };
  }

  // ページの全セル（白紙以外）を採点 → Float32Array(N) の確率。
  // z も x も L2 正規化済みなので d² = 2 - 2⟨z,x⟩、⟨z,x⟩ = scale * Σ q_k x_k（int8 のまま内積を取る）。
  function scorePage(model, fp) {
    const N = fp.N, C = fp.C, M = model.X.length;
    const feat = fp.feat, scale = fp.scale, X = model.X, alpha = model.alpha, twoLs2 = model.twoLs2;
    const outA = model.kernel.outA, outB = model.kernel.outB;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const base = i * C, s = scale[i];
      let acc = 0;
      for (let m = 0; m < M; m++) {
        const x = X[m];
        let dot = 0;
        for (let k = 0; k < C; k++) dot += feat[base + k] * x[k];
        const d2 = Math.max(0, 2 - 2 * s * dot);
        acc += Math.exp(-d2 / twoLs2) * alpha[m];
      }
      out[i] = 1 / (1 + Math.exp(-(outA * acc + outB)));
    }
    return out;
  }

  // 候補を選ぶ。points: [{ score, i(疎 index), classId }]、sizes: classId → {w,h}（正規化）、
  // exclude: [{ cx, cy, classId }]（正規化中心。既存の bbox と却下の周りには出さない）。戻りは正規化 bbox。
  function propose(fp, points, threshold, sizes, exclude, maxCandidates) {
    const m = fp.meta, W = m.width, H = m.height, Wf = m.featureWidth;
    const pxSize = classId => {
      const s = sizes[classId];
      return { w: s.w * W, h: s.h * H };
    };
    const minDistOf = (a, b) => {
      const sa = pxSize(a), sb = pxSize(b);
      return 1.1 * Math.max((sa.w + sa.h) / 2, (sb.w + sb.h) / 2);
    };
    const pts = [];
    for (const p of points) {
      if (p.score <= threshold) continue;
      const cell = fp.cells[p.i];
      pts.push({ score: p.score, classId: p.classId, cx: (cell % Wf) * m.stride, cy: Math.floor(cell / Wf) * m.stride });
    }
    pts.sort((a, b) => b.score - a.score);
    const ex = exclude.map(e => ({ cx: e.cx * W, cy: e.cy * H, classId: e.classId }));
    const kept = [];
    for (const p of pts) {
      if (kept.length >= maxCandidates) break;
      let ok = true;
      for (const e of ex) {
        if (Math.hypot(p.cx - e.cx, p.cy - e.cy) <= minDistOf(p.classId, e.classId)) { ok = false; break; }
      }
      if (!ok) continue;
      for (const k of kept) {
        if (Math.hypot(p.cx - k.cx, p.cy - k.cy) <= minDistOf(p.classId, k.classId)) { ok = false; break; }
      }
      if (ok) kept.push(p);
    }
    return kept.map(p => {
      const s = pxSize(p.classId);
      return { classId: p.classId, score: p.score, bbox: [(p.cx - s.w / 2) / W, (p.cy - s.h / 2) / H, s.w / W, s.h / H] };
    });
  }

  NS.GpEngine = { GpFeatures, GpFeatureStore, fitGP, scorePage, propose, NOISE };
})(window.SymbolAnnotator);
