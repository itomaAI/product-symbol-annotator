window.SymbolAnnotator = window.SymbolAnnotator || {};

(function(NS) {
  NS.Config = {
    appName: "Symbol Annotator v2",
    projectExtension: ".saproj",
    pdfRenderScale: 3.0,
    minBoxSize: 5,
    maxHistory: 80,
    ui: {
      zoomMin: 0.08,
      zoomMax: 8,
      zoomStep: 1.12,
      handleScreenSize: 10
    },
    defaultCatalog: [
      {
        id: "cls_default_1",
        type: "class",
        name: "感知器",
        description: "天井付・一般",
        color: "rgba(255, 82, 82, 0.24)",
        borderColor: "#ff5252",
        legendImage: null,
        products: [
          {
            id: "prod_default_1",
            type: "product",
            name: "製品A",
            description: "熱感知器",
            appearanceImage: null
          }
        ]
      }
    ]
  };
})(window.SymbolAnnotator);