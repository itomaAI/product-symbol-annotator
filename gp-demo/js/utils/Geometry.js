window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  const Geometry = {
    normalizeRect(x1, y1, x2, y2) {
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      return [x, y, w, h];
    },

    pointInRect(px, py, rect) {
      const [x, y, w, h] = rect;
      return px >= x && px <= x + w && py >= y && py <= y + h;
    },

    rectIntersect(rect1, rect2) {
      const [x1, y1, w1, h1] = rect1;
      const [x2, y2, w2, h2] = rect2;
      return !(x2 > x1 + w1 || x2 + w2 < x1 || y2 > y1 + h1 || y2 + h2 < y1);
    },

    screenToCanvas(event, canvasStack, scale) {
      const rect = canvasStack.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / scale,
        y: (event.clientY - rect.top) / scale
      };
    },

    clampRect(rect, minSize = 5) {
      let [x, y, w, h] = rect;
      if (w < minSize) w = minSize;
      if (h < minSize) h = minSize;
      return [x, y, w, h];
    },

    dataUrlToBase64(dataUrl) {
      return dataUrl.replace(/^data:image\/png;base64,/, "");
    },

    slugifyFilename(name) {
      return String(name || "project")
        .replace(/\.[^.]+$/, "")
        .replace(/[^\w\-一-龠ぁ-んァ-ヶー]+/g, "_")
        .replace(/^_+|_+$/g, "") || "project";
    }
  };

  NS.Geometry = Geometry;
})(window.SymbolAnnotator);