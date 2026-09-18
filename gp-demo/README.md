# Symbol Annotator — GP 自動提案デモ

親ディレクトリの Symbol Annotator をそのまま写し、**GP（ガウス過程）による bbox の自動提案**を足したデモ。
元ツールのファイルは触っていない（このディレクトリだけで完結する）。

- 配信: `https://itomaai.github.io/product-symbol-annotator/gp-demo/`
- 元ツールとの差分: `index.html`（GP パネルの markup と script の追加）／`css/gp.css`／`js/gp/*`。それ以外は同一

## 何ができるか

1. 起動すると同梱の `data/source.pdf`（電気設備図・31 ページ）を自動で読み、p18（電灯コンセント設備 平面図）を開く
2. サイドバーでクラスを選び、図面上で記号を 1 つ以上 bbox にする（ふつうのアノテーション操作）
3. 「**「〈クラス〉」を提案**」を押す → 同じ記号の候補が点線の箱で出る
   - **✓** … そのクラスの bbox として追加（Undo できる）
   - **✗** … 却下。そのクラスの負例として覚える（プロジェクト保存 `.saproj` に入る）
   - 閾値スライダで候補の数を絞る（再計算なし）
4. 「**表示中の N 件をすべて承認 → 再計算**」で 1 巡。承認した bbox が正例に加わって次の候補が出る
5. 「**全クラス**」は bbox のある全クラスを一度に提案する（各セルは事後確率が最も高いクラスに割り当てる）

## GP の「クラスごと」の分け方

クラス c について:

- 正例 … クラス c の bbox の中心セルの埋め込み（読み込み済みの全ページ）
- 負例 … **他のクラスの bbox** ＋ クラス c で **✗ した箱**
- 各セルの事後平均 → ロジット `a·m + b` → sigmoid を「クラス c である確率」とし、既存の bbox・却下の周囲を除いて峰を拾う。箱の大きさはクラス c の bbox の平均

カーネルは [sekisan-gp-demo](https://github.com/itomaAI/sekisan-gp-demo) と同じ学習済み deep-kernel GP（`auto-sekisan` の `outputs/gp_kernel_detector_v1`。RBF・lengthscale 固定・出力アフィン）。
支持点は正例・負例それぞれ 80 まで（超えたら等間隔に間引く）。

## 同梱データ（`data/`）

ブラウザで特徴抽出はしない。**平面図 8 ページ分**（p10, 13, 18, 19, 21, 23, 26, 28）の埋め込みを事前計算して同梱している。
それ以外のページでは提案できない（パネルにその旨が出る）。

- 描画: `pdftoppm -r 360`（PDF の 72 dpi に対して scale 5。学習データの renderScale 3〜5 に合わせ、記号が 30〜40 px になる）
- 埋め込み: 128 次元・stride 8・3×3 平均＋L2 正規化（モデルの出力そのまま）
- **インクの近く（1 セル膨張）のセルだけ**を持ち、**int8**（セルごとのスケール）で量子化。1 ページ 10〜20 MB。
  量子化による距離² の誤差は最大 1e-4（lengthscale² ≈ 0.10 に対して無視できる）
- ファイル: `pNN/meta.json`（寸法・カーネル）／`cells.bin`（uint32 のセル index）／`feat.bin`（int8 N×128）／`scale.bin`（float32 N）
- 生成スクリプト: `auto-sekisan/demo/annot_demo/precompute_pages.py`（kukuri・GPU）。ページを増やすには `--pages` に足して `data/` を差し替えるだけ

## 制限

- 「Open PDF」で別の PDF を開くと提案は使えない（特徴が無い）
- 候補の箱の大きさはクラスの平均なので、向きや長さが違う記号には合わない（[箱の精度の診断](https://github.com/itomaAI/sekisan-gp-demo) と同じ）
- 特徴を読み込んだページだけが支持点になる（未読のページの bbox は、そのページを開くまで使わない）
