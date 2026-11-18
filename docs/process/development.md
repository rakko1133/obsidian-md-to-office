# 開発の手順

最終更新: 2026-11-18（変換結果を Word で開かずに確かめる一覧ページを追加）

## 必要なもの

- Node.js 22 以上（確認した版: 22.17.0）と npm
- Obsidian 1.15.1 以上（`manifest.json` の `minAppVersion`）
- 変換結果の一覧ページ（`npm run preview:export`）を使うときだけ: Windows、Microsoft Word（.xlsx があれば Excel）、Python 3.12 と `pywin32`・`PyMuPDF`・`Pillow`・`numpy`（`pip install pywin32 pymupdf pillow numpy`）

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
| `npm run preview:export` | `test-vault/_export` の .docx / .xlsx を PDF → PNG にし、基準画像と比べた一覧ページ `.preview/index.html` を作る |
| `npm run preview:approve` | 今回の PNG を基準画像（`.preview/baseline/`）として登録する |

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

## 変換結果を Word で開かずに確かめる（一覧ページ）

各 .docx を Word で 1 つずつ開く代わりに、`scripts/preview-export.py` でまとめて画像にして確かめる。

1. Obsidian でサンプルのフォルダを変換する（出力は `test-vault/_export/`）
2. `npm run preview:export`（63 ファイルで約 20 秒。PDF が .docx より新しければ PDF 化を省く）
3. `.preview/index.html` をブラウザで開く（`python scripts/preview-export.py --open` なら自動で開く）
4. 見た目に問題がなければ `npm run preview:approve` で基準画像にする

- 仕組み: Word / Excel を COM オートメーションで画面に出さずに起動し（`DispatchEx` で別のインスタンスを作るので、開いている Word には触らない）、`ExportAsFixedFormat` で PDF にする。Word 自身のレイアウトエンジンで描くので、Word で開いたときとほぼ同じ見た目になる。PDF は PyMuPDF で 1 ページずつ PNG にする
- 比較: 基準画像とピクセル単位で比べる（1 チャンネルあたりの差が 16 以下はアンチエイリアスの揺れとして無視する）。一覧ページの既定では「変化あり」「基準なし」「エラー」だけを表示し、変わったページは「基準・今回・差分（違う箇所を赤）」を並べる
- Word が開けないファイル（壊れている .docx）は「エラー」になり、Word のメッセージが表示される。手で開いたときの「ファイルが壊れている可能性があります」はここで見つかる
- 一部だけ: `python scripts/preview-export.py --only word3b`。倍率: `--zoom 1.5`。結果は `.preview/summary.json` にもあり、Claude Code に「一覧の結果を見て」と頼むと PNG を読んで確かめられる
- `.preview/` は Git の管理対象外。基準画像はその PC のフォントで描くので、PC ごとに作る
- LibreOffice は確認の対象外（未確認だが、開ける見込みという位置づけ。requirements.md の G5 の 2026-11-18 更新）

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

## フェーズ 3b の手動確認（完了条件 A）

準備: テスト用 Vault に Dataview プラグインを入れて有効にする（コミュニティプラグインから）。dataviewjs を確かめるには、Dataview の設定で「Enable JavaScript Queries」をオンにする（既定はオフ。オフのままなら dataviewjs は描画できなかったとして、コードのまま残って警告が出る）。`npm run build:dev`（テスト用のコードブロックの処理を登録する開発用ビルド）→ `npm run deploy:test-vault` → Obsidian でプラグインを無効 → 有効にする。サンプルは `test-vault/word3b/`（6 本と、Dataview の対象の `data/`）。フォルダ `word3b` を右クリック →「Word（.docx）に変換」。各 .docx を Word で開くか、一覧ページ（`npm run preview:export`）で確かめる。

- [x] `01-math`（2026-11-18 Claude が Obsidian で変換し、Word で確認）: インラインとブロックの数式が Word の数式になる（数式をクリックすると Word の数式ツールで編集できる）。分数・根号・総和・積分・極限・行列・場合分け・aligned・記号。`\sideset` と `\genfrac` の式は画像になり、`\undefinedcommand` は LaTeX のまま残る。レポートに警告が 3 件出る。コードの中の `$x$` は数式にならない
- [x] `02-dataview`（2026-11-18 Claude が Dataview 0.5.68 を入れて確認）: TABLE が表（「データ A」のリンクをクリックすると `data/データ A.docx` が開く）、LIST がリスト、TASK が ☐ ☑ 付きのリスト、dataviewjs の見出し・段落・表が入る。インラインのクエリは文字のまま。Dataview を無効にして変換すると、コードのまま残って警告が出る
- [x] `03-plugin-blocks`（2026-11-18 Claude が確認）: テスト用の SVG の図と、少し遅れて描かれる canvas の図（と、その下の段落）が画像として入る。登録のない言語はコードのまま。Mermaid は図になる
- [x] `04-external-images`（2026-11-18 Claude が確認。Wikipedia のロゴはサムネイルの URL が 400 を返すようになったので、元の SVG の URL に変えた）: 設定「外部の画像をダウンロードする」がオフならリンク、オンなら画像が入る（Wikipedia のロゴは幅 120）。見つからない画像はリンクのまま残って警告が出る
- [x] `05-callout-theme`（2026-11-18 Claude が確認）: 設定「コールアウトの色」を「使っているテーマの色」にし、テーマか CSS スニペットで色を変えて変換すると、その色になる
  - スニペットの例（`test-vault/.obsidian/snippets/` に置き、設定 → 外観 → CSS スニペットで有効にする）: `.callout[data-callout="note"] { --callout-color: #d600d6; }`。Obsidian 1.15 の `--callout-color` は色そのもの（`#…`・`rgb(…)`・`color-mix(…)`）を書く。古いテーマの `r, g, b` の形も読める
- [x] `06-all-in-one`（2026-11-18 Claude が確認）: コールアウトの中と表のセルの中の数式、Dataview の LIST が入る
- [ ] 確認の後、`npm run build` の本番ビルドに戻して配置する（本番ビルドにはテスト用の処理がない）

## フェーズ 3a の手動確認（完了条件 A）

準備: `npm run build` → `npm run deploy:test-vault` → Obsidian でプラグインを無効 → 有効にする。サンプルは `test-vault/word3a/` にある（11 本と、埋め込み用の `parts/`・画像などの `attachments/`）。フォルダ `word3a` を右クリック →「Word（.docx）に変換」で、`parts/` も含めてまとめて変換する。各 .docx を Word と LibreOffice で開き、次を確かめる。

- [x] `01-internal-links`: 別のノートへのリンクをクリックすると、`_export/word3a/` の .docx が開く。`[[01-headings]]` は文字だけ（`word/` を変換したことがあればリンクになる）。「同じノートの中へのリンク」の各リンクで、文書内の見出し・段落・リストの項目・表に飛ぶ。本文に `^para1` などの文字が残っていない。レポートにリンク切れの警告が 2 件出る
- [x] `02-embed-notes`: ノート全体・節 B だけ・引用のブロックだけ・リストの項目だけが入る。節 B の下の見出しは「見出し 3」のまま。入れ子の埋め込みで節 C が入る。循環参照は cycle-a と cycle-b が 1 回ずつ入って止まり、警告が出る。文の途中の埋め込みは前後の文が別の段落になる。見つからないものは文字で残り、警告が出る
- [x] `03-images`: PNG・JPEG・WebP・GIF・SVG が入る。JPEG は本文の幅に縮む。幅 200、300×100、幅 150 の指定が反映される。画像を右クリック →［代替テキストの編集］で代替テキストが入っている。外部 URL の画像はリンクになり、見つからない画像は文字のまま残って警告が出る
- [x] `04-callouts`: 種類ごとに左の罫線と背景の色が変わり、タイトル（なければ種類名）が太字で出る。折りたたみのコールアウトも中身が出る。入れ子は表の中の表になる。普通の引用は「引用文」のまま
- [x] `05-code`: TypeScript・Python・JSON・Bash に色が付く。言語が分からないものと指定なしは色なし。設定「コードブロックに行番号を付ける」をオンにすると行番号が付く
- [x] `06-footnotes`: 脚注とインライン脚注がページの下の Word の脚注になり、同じ脚注を 2 回参照すると同じ番号になる。定義のない `[^none]` は文字のまま
- [x] `07-comments`: コメントの中身が出ない。コードの中の `%%` は残り、Mermaid の図は描かれる。最後の閉じていないコメントから後ろは出ない。設定「コメントを Word のコメントとして残す」をオンにすると、Word の［校閲］にコメントとして出る
- [x] `08-frontmatter`: ［ファイル］→［情報］→［プロパティ］→［詳細プロパティ］で、タイトル・作成者・キーワード・作成日時と、ユーザー設定の status・aliases が入っている。設定「冒頭にプロパティの表を出す」をオンにすると本文の前に表が出る
- [x] `09-html`: 下線・下付き・上付き・マーカーが付き、span と div は文字だけ残る。`<br>` で改行される（表のセルの中も）。改ページの div の後ろが次のページから始まる
- [x] `10-attachments`: PDF と音声はファイル名のリンクになり、クリックすると Obsidian でそのファイルが開く。Canvas は文字のまま残って警告が出る。Excalidraw は書き出し済みの SVG が画像として入る
- [x] `11-all-in-one`: 上の要素が組み合わさっても崩れない。見出しのコメントが消えている

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
