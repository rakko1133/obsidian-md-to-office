# 開発の手順

最終更新: 2026-11-18（フェーズ 1 の確認手順を追加）

## 必要なもの

- Node.js 22 以上（確認した版: 22.17.0）と npm
- Obsidian 1.15.1 以上（`manifest.json` の `minAppVersion`）

## コマンド

| コマンド | 内容 |
|---|---|
| `npm install` | 依存をインストールする |
| `npm run dev` | 開発ビルドを作り、ソースの変更を監視して作り直す |
| `npm run build:dev` | 開発ビルドを 1 回だけ作る。開発用のコマンドが入る |
| `npm run build` | 型チェックのあと本番ビルドを作る（圧縮あり、開発用のコマンドなし）。`main.js` の大きさを表示する |
| `npm run typecheck` | 型チェックだけをする |
| `npm test` | Vitest の単体テストを実行する |
| `npm run deploy:test-vault` | ビルド結果（`main.js`・`manifest.json`）をテスト用 Vault のプラグインフォルダにコピーする |

## ソースの構成

| 場所 | 内容 | Obsidian API |
|---|---|---|
| `src/main.ts` | プラグインの入口 | 使う |
| `src/obsidian/` | 設定画面・コマンドなど、Obsidian に依存する部分 | 使う |
| `src/core/` | 変換の中核（G2） | **使わない** |
| `src/i18n/` | UI の文字列（英語・日本語: H6） | **使わない** |
| `tests/` | Vitest の単体テスト | — |

`src/core/` と `src/i18n/` が `obsidian` を import していないことは、`tests/architecture.test.ts` で検査している（G2・G4）。

## テスト用 Vault で動かす

1. `npm run build:dev`（開発用のコマンドを試すとき）または `npm run build`
2. `npm run deploy:test-vault`
3. Obsidian で「保管庫としてフォルダを開く」から `test-vault/` を開く
4. 初回だけ: 設定 → コミュニティプラグイン で「制限モード」をオフにし、Batch Office Export を有効にする
5. ソースを変えたら 1〜2 をやり直し、Obsidian でプラグインを無効 → 有効にする（または Obsidian を再読み込みする）

- `test-vault/.obsidian/` の中は、`community-plugins.json`（プラグインを有効にする設定）以外は Git の管理対象外にしている
- このリポジトリのルートも Obsidian の Vault として開いている場合、`test-vault/` のノートもルートの Vault に表示される。気になるときは、ルートの Vault の 設定 → ファイルとリンク → 除外するファイル に `test-vault/` を足す

## フェーズ 0 の手動確認（完了条件 B1〜B4）

Obsidian を使う確認は自動化していない（G5）。テスト用 Vault で次を確かめる。

- [ ] B1: 上の手順で、コミュニティプラグインの一覧に Batch Office Export が出て、有効にできる
- [ ] B2: 設定 → コミュニティプラグイン で、表示名・バージョン 0.0.1 が表示される
- [ ] B3: 設定画面に「出力フォルダ」（英語表示では Output folder）が表示される。値を変えて Obsidian を再起動しても、変えた値が残っている
- [ ] B4: `npm run build:dev` で配置したうえで、コマンドパレットから「開発用: サンプルの .docx と .xlsx を書き出す」を実行する。`{出力フォルダ}/_dev/sample.docx` と `sample.xlsx` ができ、Word と LibreOffice の両方で開ける（文字「Batch Office Export: sample」が入っている）
- [ ] B5（確認のみ）: Obsidian の表示言語を英語にすると、設定画面とコマンド名が英語になる

## フェーズ 1 の手動確認（完了条件 A1〜E2）

準備: `npm run build` → `npm run deploy:test-vault` → Obsidian でプラグインを無効 → 有効にする。確認用のノートは `test-vault/phase1/` にある。

- [ ] A1: 次の 4 つの方法で「Mermaid 画像として保存」の確認画面が開く
  - `phase1/folder-a/with-diagram.md` を右クリック
  - フォルダ `phase1/folder-a` を右クリック
  - ファイルを 2 つ以上選んで右クリック
  - コマンドパレットの「現在のノートの Mermaid 画像を保存」「Vault 全体の Mermaid 画像を保存」
- [ ] A2: フォルダ `phase1/folder-a` を右クリックすると、`sub/nested.md` が含まれ、`private.md`（`export: false`）と `drawing.excalidraw.md`（除外パターン）が除外される。`drawing.excalidraw.md` を直接右クリックすると変換される。`private.md` を直接右クリックすると除外される
- [ ] A3: フォルダ `phase1/only-excluded` を右クリックすると、確認画面は出ず Notice が出る。何も書き込まれない
- [ ] B1: 確認画面に、フォルダごとのチェックボックス付きの一覧、件数、ノートごとの図の数と「新規 / 変更なし」、各ファイルの出力パス（折りたたみ）が出る。チェックを全部外すと保存ボタンが押せない。キャンセルすると何も書き込まれない
- [ ] C1: フォルダ `mermaid` を保存すると、画面右上に「n / 全体件数」と処理中のノート名が出る。途中で「中断」を押すと、処理中のノートを終えてから止まり、レポートに「中断しました」と出る
- [ ] D1: フォルダ `mermaid` をすべて保存すると、`_export/mermaid/` に `{ノート名}_mermaid_01_{ハッシュ8桁}.png` ができる。画像は白い背景で、プロパティ（Windows ならファイルのプロパティ → 詳細）の解像度が 192 dpi。描画できない図種があれば、レポートの「警告」に出る
- [ ] D2: もう一度保存すると、確認画面でもレポートでも、すべて「変更なし」になる。`mermaid/01-flowchart.md` の図を 1 か所直して保存すると、その図だけ新しいファイルになり、古いファイルは消える
- [ ] D3: `_export/mermaid/23-flowchart-japanese_mermaid_01_*.png` の日本語が読める
- [ ] D4: 書き出した後も、Obsidian のプレビューの Mermaid の表示（テーマ・フォント）が書き出す前と同じ。`phase1/user-directive.md` のプレビューは dark のまま、書き出した画像は neutral になる
- [ ] E1: 書き出した後、`_export/` の中に `.tmp` で終わるファイルがない。元のノートの更新日時が変わっていない
- [ ] E2: 結果レポートに件数（成功・スキップ・失敗）と警告が出る。`phase1/folder-a/broken.md` は失敗、`no-diagram.md` はスキップになる。`test-vault/.obsidian/plugins/batch-office-export/export-manifest.json` に、`_export/...` の相対パスで記録されている

## フェーズ 2 の手動確認（完了条件 A〜C）

準備: `npm run build` → `npm run deploy:test-vault` → Obsidian でプラグインを無効 → 有効にする。サンプルは `test-vault/word/` にある（11 本）。

- [ ] A: フォルダ `word` を右クリック →「Word（.docx）に変換」で確認画面が開き、各ノートに `_export/word/{ノート名}.docx` と「新規」が出る。保存するとレポートが出る。もう一度実行すると「上書き」になる。設定で同名ファイルの扱いを「スキップ」「連番」にすると、それぞれ「スキップ」「連番を付けて保存」になる。コマンドパレットの「現在のノートを Word に変換」「Vault 全体を Word に変換」でも開く
- [ ] B: `_export/word/` の各 .docx を Word と LibreOffice で開ける。そのうえで次を確かめる
  - `01-headings`: 見出しが「見出し 1〜6」のスタイルで、Word のナビゲーションウィンドウに出る
  - `02-paragraphs`: 単一改行が改行になる（Obsidian の「厳密な改行」がオフのとき）。行末の空白 2 つは常に改行
  - `03-lists`: 箇条書きと番号の入れ子、別のリストで番号が 1 から振り直される、3 から始まるリスト
  - `04-tasks`: ☐ ☑ ◐ ☒ ➔ の記号。`[?]` は文字のまま
  - `05-tables`: 列の配置（左・中央・右）、セルの中の書式、2 ページ目以降にも見出し行が出る
  - `06-inline-format`: 太字・斜体・取り消し線・ハイライト（黄）・インラインコード
  - `07-mermaid`: 図が画像として入り、横に長い図は本文幅に、縦に長い図は 1 ページに収まる。最後の図はソースのコードブロックとして残り、レポートに警告が出る
  - `08-quote-code-hr`: 引用が「引用文」スタイル、コードが等幅と網掛け、水平線
  - `09-links`: 外部リンクとメールがクリックできる。内部リンクは文字だけ
  - `10-unsupported`: 画像・脚注・HTML が Markdown のまま等幅で残り、レポートに警告が出る
  - `11-all-in-one`: frontmatter が本文に出ない
- [ ] C: Word の［レイアウト］で A4・縦・余白 25 mm。本文が游明朝 / Century、見出しが游ゴシック / Arial。［ファイル］→［情報］のプロパティで、タイトルがノート名、作成者が空（設定の「作成者」を入れるとその値）
