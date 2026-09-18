window.SymbolAnnotator = window.SymbolAnnotator || {};

// デモ用の既定カタログ。同梱 PDF（電気設備図・A4 縮小）の平面図に出る記号を想定した仮の名前で、
// 名前・色はカタログエディタ（⚙）で自由に変えられる。製品（子）は空。
(function(NS) {
  const palette = [
    ["rgba(255, 82, 82, 0.24)", "#ff5252"],
    ["rgba(98, 210, 255, 0.24)", "#62d2ff"],
    ["rgba(122, 240, 185, 0.24)", "#4fd58f"],
    ["rgba(255, 196, 61, 0.24)", "#ffc43d"],
    ["rgba(232, 121, 249, 0.24)", "#e879f9"],
    ["rgba(255, 140, 66, 0.24)", "#ff8c42"]
  ];
  const names = [
    ["コンセント", "2ET など"],
    ["照明器具", "天井灯・ダウンライト"],
    ["スイッチ", "片切・3路"],
    ["感知器", "煙・熱（自火報）"],
    ["インターホン", "子機・玄関機"],
    ["その他", "上に無い記号"]
  ];
  NS.Config.appName = "Symbol Annotator v2 (GP demo)";
  NS.Config.defaultCatalog = names.map((n, i) => ({
    id: `cls_demo_${i + 1}`,
    type: "class",
    name: n[0],
    description: n[1],
    planestCategoryId: "",
    planestItemId: "",
    color: palette[i][0],
    borderColor: palette[i][1],
    legendImage: null,
    products: []
  }));
})(window.SymbolAnnotator);
