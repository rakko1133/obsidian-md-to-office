# Batch Office Export

ノートを Word 文書（.docx）・Excel ブック（.xlsx）・PDF に一括変換する [Obsidian](https://obsidian.md) のプラグインです。Mermaid の図は画像にします。

[English (README.md)](README.md)

- 1 つのノート・フォルダ・Vault 全体を 1 回で変換
- Word: 見出し・リスト・表・コード（色付け）・コールアウト・脚注・数式・画像・埋め込み・Mermaid の図・Dataview の結果
- Word: 複数のノートを 1 つの文書に結合（ファイル名順・frontmatter の順・目次ノート（MOC）の順）。表紙と目次を付けられる
- Excel: ノートの表を書き出す（1 ノート = 1 シート、または 1 表 = 1 シート）、ノートのアウトラインを書き出す。Vault のタスク・frontmatter・Dataview の表を 1 つのブックに集計
- PDF: Obsidian の読みモードと同じ見た目（数式・Mermaid・Dataview・コールアウトも表示どおり）。しおり・PDF 間のリンク・ページ番号が入り、結合・表紙・目次は Word と同じように使える
- Mermaid の図を SVG / PNG のファイルとして保存
- 英語・日本語の UI（Obsidian の言語設定に合わせる）

このプラグインは Microsoft とは関係ありません。「Word」「Excel」はファイル形式（.docx / .xlsx）のことで、出力したファイルはこれらの形式に対応したほかのアプリでも開けます。

## 動作環境

- Obsidian 1.15.1 以降、**デスクトップ版のみ**（Windows・macOS・Linux）。Node.js のファイル操作の API を使うため、モバイル版では動きません。

## インストール

Obsidian の **設定 → コミュニティプラグイン → 閲覧** で「Batch Office Export」を検索し、インストールして有効にします。

手動で入れる場合: [最新のリリース](https://github.com/rakko1133/obsidian-md-to-office/releases/latest) から `main.js`・`manifest.json`・`styles.css` をダウンロードし、`<Vault>/.obsidian/plugins/batch-office-export/` に置いて、**設定 → コミュニティプラグイン** で有効にします。

## 使い方

### コマンド

コマンドパレット（Ctrl/Cmd + P）で「Batch Office Export」と入力します。

| コマンド | 内容 |
|---|---|
| 現在のノートを Word / Excel / PDF に変換 | 開いているノートを変換 |
| Vault 全体を Word / Excel / PDF に変換 | 対象の設定に合うノートをすべて変換 |
| 現在のノート / Vault 全体を変換（形式を選ぶ） | 確認画面で Word・Excel・PDF を組み合わせて選ぶ |
| Vault を Excel に集計 | タスク・frontmatter・Dataview の表を 1 つのブックにまとめる |
| 現在のノート / Vault 全体の Mermaid 画像を保存 | 図を 1 つずつ SVG / PNG で保存 |

### ファイルのメニュー

ファイルエクスプローラーでノートやフォルダを右クリックし（複数選択も可）、**Word（.docx）に変換**・**Excel（.xlsx）に変換**・**PDF に変換**・**形式を選んで変換…**・**Mermaid 画像として保存** を選びます。

変換の前に、対象のファイルと出力先を確認画面に表示します。ファイルを外したり、形式を選んだり、Word と PDF では **1 フォルダを 1 つのファイルにまとめる** をオンにしたりできます。変換の後は、結果・警告・エラーを一覧にした報告を表示します。

### 出力先

既定では、Vault の `_export` フォルダに、ノートのフォルダ構成をそのまま写して出力します。フォルダを変える、ノートと同じフォルダに出力する、Vault の外のフォルダに出力する、を設定できます（**設定 → Batch Office Export → 出力**）。

## 設定

| 区分 | 主な設定 |
|---|---|
| 出力 | 出力形式の初期値、出力先（Vault の中・外）、ミラー出力 / 同じフォルダ、同名のファイルがあるとき（上書き・スキップ・連番） |
| 変換対象 | 含める・除くパターン（glob）。既定で `**/*.excalidraw.md` を除く |
| 実行 | ノートの変換に失敗したときの動き、1 ノートのタイムアウト |
| Mermaid の画像 | SVG / PNG、PNG の解像度、透明な背景、フォント、変換のときに図を画像ファイルとしても保存する |
| Word | 用紙・向き・余白、フォント、ファイル名を表題にする、作成者名、改行、コードの行番号、コメント、frontmatter の表、外部の画像、コールアウトの色、ページ番号、ヘッダーの表題、表紙、目次、結合の順番、テンプレート（.docx / .dotx）、見出しの段落番号、見出し 1 の前の改ページ、表の幅、図表番号 |
| Excel | 1 フォルダ = 1 ブック / 1 ノート = 1 ブック、1 ノート = 1 シート / 1 表 = 1 シート、アウトライン形式、Excel のテーブル、元ノートの列 |
| PDF | 用紙・向き・余白・拡大率、本文の文字の大きさ・フォント、コードのフォント。表紙・目次・ヘッダー・フッターは Word の設定に従う |

## 注意

- **ネットワークの使用**: ノートの内容を外部に送ることはありません。ネットワークを使うのは **Word → 外部の画像をダウンロードする** をオンにしたとき（既定はオフ）だけで、URL で指定した画像（`![](https://…)`）を 1 枚 20 MB までダウンロードして埋め込みます。オフのときはリンクにします。
- **Vault の外のファイル**: Vault の外の出力先や、絶対パスのテンプレートを設定したときだけ、Vault の外のファイルを読み書きします。
- **Dataview**: `dataview` / `dataviewjs` のブロックの結果を入れるため、ノートを開いたときと同じように Obsidian に描画させます。そのため、変換するノートの `dataviewjs` のコードは、閲覧モードで開いたときと同じく実行されます。これらのブロックを変換するには Dataview プラグインが必要です。
- **PDF**: Obsidian の読みモードの表示を、Obsidian の印刷用のスタイルで印刷します。PDF に変換している間は Obsidian がライトテーマに切り替わり、終わると元に戻ります。PDF の目次にはページ番号がなく、別の PDF へのリンクはその PDF の 1 ページ目を開きます。
- **プラグインが残すファイル**: 過去の出力の記録（`export-record.json`）と、描画した図のキャッシュを、プラグインのフォルダ（`.obsidian/plugins/batch-office-export/`）に保存します。
- **描画**: Mermaid の図・数式・コードの色付けは Obsidian 自身の描画を使うので、見た目は Obsidian の版に従います。Word の数式で表せない式は、同梱の MathJax で画像にして埋め込みます。

## ソースからのビルド

```sh
npm install
npm run build   # 型チェックと本番ビルド -> main.js
npm test        # 単体テスト（Vitest）
```

設計の文書は [docs/](docs/README.md) にあります。

## ライセンス

[MIT](LICENSE)。同梱しているほかのパッケージとそのライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります（`node scripts/third-party-notices.mjs` で生成）。
