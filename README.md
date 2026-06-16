# Symbol Annotator

PDF図面上の記号・設備シンボルをBBoxでアノテーションするための静的Webアプリです。

`workspace/msd_annotation_tool` の試作品をベースに、UI、状態管理、エクスポート仕様、コード分割を整理した再実装版です。

## 特徴

- GitHub Pagesに配置可能な静的HTML/CSS/JS構成
- PDF.jsによる高解像度PDFレンダリング
- Canvas transformによる高速なズーム・パン
- クラス選択状態を維持した連続アノテーション
- 既存BBoxの移動・リサイズ・削除
- 凡例画像の切り抜き保存
- Undo / Redo
- 使用クラスだけを表示するクラス選択モーダル
- `.saproj` によるPDF込みのプロジェクト保存・復元
- 学習用ZIP出力
  - `annotations.json`
  - `pages/*.png`
  - `legends/*.png`

## 起動方法

`index.html` をブラウザで開きます。

GitHub Pages等の静的ホスティングにそのまま配置できます。

## 主な操作

| 操作 | 内容 |
|---|---|
| Open PDF | PDF図面を読み込む |
| サイドバーのクラスをクリック | アノテーション対象クラスを選択 |
| 図面上でドラッグ | BBox作成 |
| クラス右側の `✂` | 凡例切り抜きモード |
| 登録済み凡例の `×` | そのクラスの凡例のみ削除 |
| 既存BBoxをクリック | 選択 |
| 選択BBox内部をドラッグ | 移動 |
| 四隅ハンドルをドラッグ | リサイズ |
| Delete / Backspace | 選択BBoxを削除 |
| Space + Drag | パン |
| Wheel | ズーム |
| Ctrl + Z | Undo |
| Ctrl + Shift + Z / Ctrl + Y | Redo |
| Esc | 選択解除 |
| 1〜9 | 表示中クラスのショートカット選択 |

## 出力形式

### Dataset ZIP

`Export` で以下を含むZIPを出力します。

```text
annotations.json
pages/
  {project}_page_1.png
  ...
legends/
  {class_id}.png
README.txt
```

BBox座標は、ページ幅・高さに対する相対比率 `[x_ratio, y_ratio, width_ratio, height_ratio]` です。  
Render Scaleを変更しても位置がズレないよう、内部保存・JSON出力はいずれも正規化座標を使います。  
ページ画像上のピクセル座標が必要な場合は、`annotations.json` 内の `project.pageDimensions` を使って `x_px = x_ratio * page_width` のように復元してください。

### Project File

`Save` で `.saproj` を出力します。内部はZIP形式です。

```text
manifest.json
state.json
source.pdf
```

`Load` から再読み込みすると、PDF・凡例・BBox・アクティブクラスが復元されます。

## 依存ライブラリ

CDNから以下を読み込みます。

- PDF.js
- JSZip

完全オフライン運用が必要な場合は、これらをローカル同梱に変更してください。