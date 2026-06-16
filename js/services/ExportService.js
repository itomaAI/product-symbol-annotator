window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  class ExportService {
    constructor({ store, pdfService }) {
      this.store = store;
      this.pdfService = pdfService;
    }

    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async saveProject() {
      const state = this.store.getState();
      if (!state.pdfBuffer) {
        throw new Error("保存するPDFがありません。");
      }

      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify({
        schema: "symbol-annotator-project-v1",
        savedAt: new Date().toISOString(),
        appName: NS.Config.appName
      }, null, 2));
      zip.file("state.json", this.store.exportStateJSON());
      zip.file("source.pdf", state.pdfBuffer);

      const blob = await zip.generateAsync({ type: "blob" });
      const name = `${NS.Geometry.slugifyFilename(state.project.filename)}.saproj`;
      this.downloadBlob(blob, name);
    }

    async loadProject(file) {
      const zip = await JSZip.loadAsync(file);
      const stateFile = zip.file("state.json");
      const pdfFile = zip.file("source.pdf");

      if (!stateFile || !pdfFile) {
        throw new Error("state.json または source.pdf が存在しないため、プロジェクトファイルとして読み込めません。");
      }

      const stateText = await stateFile.async("string");
      const pdfBuffer = await pdfFile.async("arraybuffer");

      const pdfInfo = await this.pdfService.loadFromBuffer(pdfBuffer);
      this.store.setPdfBuffer(pdfBuffer);
      this.store.restoreSerializedState(stateText);
      this.store.setProjectInfo({
        filename: JSON.parse(stateText).project?.filename || file.name.replace(/\.saproj$/i, ".pdf"),
        pageCount: pdfInfo.pageCount
      });

      return JSON.parse(stateText);
    }

    async exportDataset(onProgress) {
      const state = this.store.getState();
      if (!state.pdfBuffer || state.project.pageCount === 0) {
        throw new Error("PDFが読み込まれていません。");
      }

      const pagesWithAnnotations = Object.entries(state.annotations)
        .filter(([_, list]) => list.length > 0)
        .map(([page]) => parseInt(page, 10))
        .sort((a, b) => a - b);

      if (pagesWithAnnotations.length === 0) {
        throw new Error("アノテーションが一つも存在しないため、エクスポートを中止しました。");
      }

      const zip = new JSZip();
      const projectName = NS.Geometry.slugifyFilename(state.project.filename);
      const totalExportPages = pagesWithAnnotations.length;

      const tempCanvas = document.createElement("canvas");
      for (let i = 0; i < totalExportPages; i++) {
        const page = pagesWithAnnotations[i];
        if (onProgress) onProgress({ phase: "page", current: i + 1, total: totalExportPages });
        const dimensions = await this.pdfService.renderPage(page, tempCanvas, state.pdfRenderScale);
        if (dimensions) {
          this.store.setPageDimension(page, dimensions);
        }
        const dataUrl = tempCanvas.toDataURL("image/png");
        const base64 = NS.Geometry.dataUrlToBase64(dataUrl);
        const padded = String(page).padStart(String(state.project.pageCount).length, "0");
        zip.file(`pages/${projectName}_page_${padded}.png`, base64, { base64: true });
      }

      zip.file("annotations.json", this.store.exportDatasetJSON());

      state.catalog.forEach(cls => {
        if (cls.legendImage) {
          zip.file(`legends/${cls.id}.png`, NS.Geometry.dataUrlToBase64(cls.legendImage), { base64: true });
        }
        if (cls.products) {
          cls.products.forEach(prod => {
            if (prod.appearanceImage) {
              zip.file(`appearances/${prod.id}.png`, NS.Geometry.dataUrlToBase64(prod.appearanceImage), { base64: true });
            }
          });
        }
      });

      zip.file("README.txt", [
        "Symbol Annotator Dataset v2",
        "",
        "Contents:",
        "- annotations.json: project, dynamic catalog tree, and annotation metadata",
        "- pages/: rendered PDF page images (only pages with annotations)",
        "- legends/: cropped legend/symbol images for classes",
        "- appearances/: cropped appearance images for specific products",
        "",
        "Coordinate system:",
        "Bounding boxes are stored as normalized page ratios: [x_ratio, y_ratio, width_ratio, height_ratio].",
        "To convert to pixels for an exported page image, multiply x/width by the page image width and y/height by the page image height."
      ].join("\n"));

      if (onProgress) onProgress({ phase: "zip" });
      const blob = await zip.generateAsync({ type: "blob" });
      this.downloadBlob(blob, `${projectName}_symbol_dataset.zip`);
    }
  }

  NS.ExportService = ExportService;
})(window.SymbolAnnotator);