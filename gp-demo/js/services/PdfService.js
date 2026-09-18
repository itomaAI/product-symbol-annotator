window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class PdfService {
    constructor() {
      this.pdfDoc = null;
      this.currentUrl = null;
      this.renderSerial = 0;
    }

    ensureWorker() {
      if (!window.pdfjsLib) {
        throw new Error("PDF.js が読み込まれていません。");
      }
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
      }
    }

    async loadFromBuffer(buffer) {
      this.ensureWorker();
      if (this.currentUrl) {
        URL.revokeObjectURL(this.currentUrl);
        this.currentUrl = null;
      }

      const blob = new Blob([buffer], { type: "application/pdf" });
      this.currentUrl = URL.createObjectURL(blob);
      const loadingTask = pdfjsLib.getDocument(this.currentUrl);
      this.pdfDoc = await loadingTask.promise;
      return {
        pageCount: this.pdfDoc.numPages
      };
    }

    async renderPage(pageNumber, canvas, scale) {
      if (!this.pdfDoc) return null;

      const serial = ++this.renderSerial;
      const page = await this.pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      const context = canvas.getContext("2d", { alpha: false });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      context.save();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();

      await page.render({
        canvasContext: context,
        viewport
      }).promise;

      if (serial !== this.renderSerial) {
        return null;
      }

      return {
        width: canvas.width,
        height: canvas.height
      };
    }

    cropCanvas(canvas, bbox) {
      const [x, y, w, h] = bbox.map(Math.round);
      const safeW = Math.max(1, w);
      const safeH = Math.max(1, h);
      const temp = document.createElement("canvas");
      temp.width = safeW;
      temp.height = safeH;
      const context = temp.getContext("2d");
      context.drawImage(canvas, x, y, safeW, safeH, 0, 0, safeW, safeH);
      return temp.toDataURL("image/png");
    }
  }

  NS.PdfService = PdfService;
})(window.SymbolAnnotator);