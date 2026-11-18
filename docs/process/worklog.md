# 作業記録

開発の経緯を、新しいものを上にして記録する。決定の正本は `docs/requirements.md`、ここは「いつ・何をしたか・なぜか」を追うための記録。

書き方
- 見出しは日付とフェーズ。作業の区切りごとに 1 項目を足す
- 決めたこと・作ったもの・確認したこと・残っていることを書く。関係するコミットとタグを添える

---

## 2026-11-18 フェーズ 4a の準備と実装

- 決めたこと（Claude 推奨・requirements.md「フェーズ 4 の決定事項」）: フェーズ 4 を 4a（表を .xlsx にする本体・0.4.0）と 4b（アウトライン形式・Vault 全体の集計・形式の選択・0.4.1）に分ける。08 のフロー図の未決事項（18 件）のうち 4a に関わるものをすべて決めた。依存の追加はない
- 先に確かめたこと: exceljs で、Excel テーブルの中のリッチテキストとハイパーリンク、表示形式、セルの中の画像、`=1+1` が文字列のまま書かれること、目次シートを `orderNo` で先頭に置けることを、Excel で開いて確かめた。作成者が空だと `Unknown` が入る
- 作ったもの（`feat/xlsx-tables`）
  - コア: `xlsx-values.ts`（型の判定・シート名・列名・列幅）、`xlsx-render.ts`（表の取り出し・ブックの組み立て・目次・リンク先の後決め・画像）、`xlsx-export.ts`（出力単位・ノート 1 件の処理・1 フォルダ = 1 ブックの完成）。マニフェストに束ねた出力のすべての元ノートを記録するようにした。同名ファイルの設定に従う書き込みを .docx と共用にした
  - Obsidian 側: 「Excel（.xlsx）に変換」を 4 つの起動方法に足し、実行の流れに「変換の前にブックの状態を作る」「全ノートの後にブックを完成させる」段を足した。設定 3 項目
  - テスト用 Vault に `excel/`
- 途中で直したこと: コールアウトの中の表の表題が前の見出しになっていた（タイトルを使うようにした）。ブックの外のノートへのリンクが文字だけになっていた（組み立ての「変換対象」の判定を Excel ではすべて対象にし、リンク先はブックの完成時に決める）。確認画面と結果の件数が、同じブックをノートの数だけ数えていた
- 確認: 単体テスト 217 件（Excel は 46 件。型の判定・シート名・列幅の規則と、サンプルを .xlsx にして中身を確かめるテスト、数式インジェクション、タイムアウトしたノートのシートを足さないこと）。Claude が Obsidian で `excel` を変換し、Excel で開いて修復を求められないこと（テーブルが残る）と、一覧ページで見た目を確かめた。本番ビルドの main.js は 3.17 MB（+0.02 MB）
- 残り: 設定を変えたときの Obsidian での確認（単体テストでは確認済み）、本番ビルドに戻して配置、マージとタグ `0.4.0`

## 2026-11-18 フェーズ 3b 完了（タグ 0.3.1）

- 完了条件 A〜C を確認した。A は Claude が Obsidian を画面操作して変換し、一覧ページで Word の描画を見て確かめた。LibreOffice は手元にないため未確認
- `release: 0.3.1` → `feat/plugin-render` を main にマージ（`--no-ff`）→ 注釈付きタグ `0.3.1`。マージ後の main で本番ビルド（main.js 3.15 MB）とテスト 171 件が通ることを確認
- 本番ビルドをテスト用 Vault に配置した。グローバルに `MathJax` がある条件で main.js を読み込めることは Node.js で確かめたが、Obsidian でプラグインを無効 → 有効にして読み込み直す確認はしていない（画面の操作が届かなかった）
- 3b の途中で入れたもの: 変換結果の一覧ページ（`npm run preview:export`）、`mathjax-full` の同梱（main.js が 1.44 MB → 3.15 MB）
- 次: フェーズ 4（Excel）。U3 の main.js の大きさの目安（3 MB 以下の提案、未決定）は、MathJax の同梱で超えたので、決めるときに合わせて見直す

## 2026-11-18 フェーズ 3b の Dataview の確認と、取り込みの不具合の修正

- ユーザーの依頼で、Claude がテスト用 Vault に Dataview 0.5.68（blacksmithgu、コミュニティプラグインから）を入れて有効にした
- 見つかった不具合（A-24）
  - TABLE の見出しが「File2」になる: Dataview は見出しの後ろに件数（`<span class="dataview small-text">2</span>`）を出す。見出しの文字として取り込んでいた。`th` の中の件数を外してから取り込むようにした
  - dataviewjs が無効（Dataview の既定）のとき、Dataview のエラー文「Dataview JS queries are disabled…」がそのまま文書に入っていた。描画結果に `.dataview-error` があれば描画できなかったとして、原文を残してその文を警告にするようにした
- 確認: TABLE（見出し「File」、リンクは `data/データ A.docx` を指す）、LIST、TASK（☐ ☑）、`06-all-in-one` の LIST が入る。JavaScript のクエリが無効なら dataviewjs はコードのまま残って警告、有効にすると見出し・段落（太字）・表が入る。警告は数式の 3 件だけ
- テスト用 Vault の Dataview の設定は、JavaScript のクエリを有効にしたままにしてある（`.obsidian/` は Git の管理対象外）
- これで 3b の手動確認は、LibreOffice での確認を除いて終わった。残り: 本番ビルドに戻して配置、マージとタグ `0.3.1`

## 2026-11-18 フェーズ 3b の手動確認（Dataview 以外）と、テーマのコールアウトの色の不具合の修正

- Claude が Obsidian を画面操作して、3b の確認項目のうち Dataview を使わないものを確かめた
  - 数式: Word が数式オブジェクト（OMath）として認識する（`01-math` で 11 個、`06-all-in-one` で 2 個）。画像になった 2 式は画像として入る
  - 外部の画像: 設定をオンにして変換すると、Obsidian のロゴと幅 120 の Wikipedia のロゴが埋め込まれ、見つからない画像は警告になる
  - サンプルの修正: Wikipedia のロゴのサムネイルの URL（`…/thumb/…/200px-…png`）は、Wikimedia が HTTP 400 を返すようになっていた（プラグインの問題ではない）。元の SVG の URL に変えた
- 見つかった不具合: 設定「コールアウトの色」を「使っているテーマの色」にしても、色が読めず固定の色に戻っていた
  - 原因: Obsidian 1.15 の `--callout-color` は色そのもの（`var(--color-blue)` → `#086ddd`）で、`color: var(--callout-color)` や `color-mix(in oklch, var(--callout-color) 10%, …)` で使われる。`readCalloutColor` は古い形式の `r, g, b` しか読めなかった
  - 修正: CSS の色の値を 16 進 6 桁にする `src/core/css-color.ts`（`r, g, b`・`#…`・`rgb()`・`rgba()`・`color(srgb …)`）を足した。値がそのまま読めなければ（`color-mix(…)` など）、`color: var(--callout-color)` をブラウザに計算させた色を読む
  - 確認: CSS スニペットで note を `#d600d6`、tip を `rgb(255, 140, 0)`、warning を `color-mix(…)` の緑にして変換し、その色になることを一覧ページで確かめた。単体テスト 171 件
- 確認のために変えた設定（外部の画像・コールアウトの色）とスニペットは元に戻した
- 残り: Dataview の確認（`02-dataview`・`06-all-in-one` の LIST。Dataview をテスト用 Vault に入れる必要がある）、LibreOffice での確認（手元にない）、本番ビルドに戻して配置、マージとタグ `0.3.1`
- 気づいた点: 本番ビルドの main.js は 3.18 MB で、U3 で提案している目安（3 MB 以下、未決定）を超えている。大半は MathJax の SVG 出力のフォントデータ

## 2026-11-18 同梱の MathJax でプラグインが読み込めない不具合を修正し、Obsidian で確認

- 見つかったこと: ユーザーが変換し直しても `_export` が更新されなかった。Claude が Obsidian の画面を見て、プラグインの有効化で「読み込みに失敗しました」と出ることを確かめた。本体のウィンドウの開発者ツールのコンソールに `MathJax.loader.preLoad is not a function`（`mathjax-full/js/input/tex/AllPackages.js`）
  - 原因: `AllPackages.js` は、グローバルに `MathJax` があると MathJax 自身の読み込み機構とみなして `MathJax.loader.preLoad` を呼ぶ。Obsidian には同梱の MathJax（CHTML 版）がグローバルにあり、その `loader` には `preLoad` がない。単体テストと Node.js での読み込みでは、グローバルの `MathJax` がないので起きなかった
  - 修正: `AllPackages.js` を使わず、同じ一覧の TeX の拡張の設定ファイルを `math-svg.ts` で直接読み込む。グローバルの `MathJax` を見ているのは、使っているモジュールの中では `AllPackages.js` だけ
  - 回帰テスト: `math-svg.ts` を esbuild でバンドルし、グローバルに `MathJax`（`loader` に `preLoad` がない）を置いた別の文脈で実行する。修正前のコードでは同じ例外で失敗することを確かめた（`vi.resetModules` では node_modules のモジュールが読み込み直されず、再現できなかった）
- 確認: Obsidian でプラグインを有効にでき、Claude が `word3a`（15 件）と `word3b`（8 件）を変換した。失敗 0。警告は `\sideset`・`\genfrac` の画像化、`\undefinedcommand` は LaTeX のまま、Dataview が無効でコードのまま、で想定どおり。一覧ページで 63 ファイルすべてを Word で開けた（エラー 0）。脚注の 2 回目の参照が上付きの番号になり、`\sideset`・`\genfrac` が画像として出ることを画像で確かめた
- 教訓: Obsidian の中だけで起きる問題（グローバルの状態、同梱のライブラリ）は単体テストで見えない。新しい依存を足したら、Obsidian で有効にできることを確かめてから変換を頼む

## 2026-11-18 数式の画像化を同梱の MathJax に切り替え

- ユーザー決定: Obsidian 同梱の MathJax で数式を画像にできない問題は、MathJax を同梱して画像にする（ライセンスを確認した。Apache-2.0 で無料、再配布できる）
- 作ったもの: `src/core/math-svg.ts`（`mathjax-full` 3.2.2 の TeX 入力と SVG 出力。DOM を使わない liteAdaptor。`fontCache: none` で字形を SVG に直接書く。`currentColor` は黒に置き換える。読めない式は例外）。`plugin-render.ts` の `renderMath` は、これを画像（PNG の代替付き）にするだけにした。TeX の拡張は `noerrors`・`noundefined` を除いた全部
- 確認: 単体テスト 154 件（`math-svg.test.ts` の 6 件を追加）。`\sideset`・`\genfrac`・`\ce`・`\bbox` が SVG になり、`\undefinedcommand` と閉じていない式は例外になる。`word3b/01-math.md` を同梱の MathJax で変換した .docx を一覧ページで Word に描かせ、画像の式が正しく出ることを確かめた。本番ビルドの main.js は 3.18 MB（+1.74 MB）。脆弱性の警告は増えていない
- 残り: Obsidian の中での確認（PNG の代替画像は Obsidian の canvas で作るため）。公開時のライセンス文のまとめ（依存一覧に記載）

## 2026-11-18 一覧ページで 3b と Mermaid の変換結果を確認

- 対象: 18:44 に変換した `test-vault/_export`（Mermaid の黒塗りの修正 `2d904cb` を含むビルド）。一覧ページの PNG を Claude が見た
- 問題なし: Mermaid の 23 図（黒く塗りつぶされたものはない）、3b の数式（分数・根号・総和・積分・極限・行列・場合分け・揃え・記号、コールアウトと表の中の数式）、テスト用の SVG と canvas の図、外部の画像（設定オフでリンク）、コールアウト。`word/`・`word3a/` も見た目の崩れはない
- Dataview のブロックはコードのまま: テスト用 Vault に Dataview を入れていないため（想定どおり）。Dataview を入れた確認は残っている
- 見つかった不具合: `\sideset` と `\genfrac` の式が画像にならず、LaTeX のまま残る
  - 原因: Obsidian 1.15.1 に同梱の MathJax は CHTML 出力だけのビルドで、`MathJax.tex2svg` がない（`obsidian-1.15.1.asar` の中で `tex2svg` は 0 件、`tex2chtml` は 2 件）。`plugin-render.ts` の `renderMath` は常に「MathJax is not available」で失敗し、`mathFailed` に回る。単体テストは偽の DOM なので見つけられなかった
  - 対応: 同梱の MathJax に切り替えた（上の項目）
- 脚注の修正を入れた開発用ビルドを配置した。`_export` はまだ作り直していない

## 2026-11-18 変換結果を Word で開かずに確かめる一覧ページ

- きっかけ: 手動確認で各 .docx を Word で 1 つずつ開くのが手間（ユーザー）
- 作ったもの: `scripts/preview-export.py`（`npm run preview:export` / `preview:approve`）。Word / Excel の COM オートメーションで PDF にし、PyMuPDF で PNG にして、基準画像とピクセル単位で比べた一覧ページ `.preview/index.html` を作る。変わったページは基準・今回・差分を並べる。依存の追加はなし（Python のパッケージは手元にあったもの）
- 確認: `test-vault/_export` の 63 ファイルを約 18 秒で処理し、62 ファイルが画像になった
- これで見つかった不具合: `word3a/06-footnotes.docx` を Word が「ファイルが壊れている可能性があります」として開かない
  - 原因: 同じ脚注 `[^1]` を 2 回参照すると、同じ ID の `w:footnoteReference` を 2 つ出していた。Word は 1 つの脚注を 2 か所から参照することを許さない。単体テストもこの出力を期待値にしていた
  - 修正（A-10）: 2 回目以降の参照は、脚注参照のスタイル（上付き）で番号の文字だけを置く。番号は本文での出現順に振っているので、Word が表示する番号と一致する。修正後のコードで変換した 06-footnotes は Word で開け、脚注が 3 つ、2 回目の参照が上付きの「1」になることを画像で確かめた
  - 残り: Obsidian でもう一度変換して `_export` の .docx を作り直す（今の `_export` は修正前のもの）
- 気づいた点（未対応）: 見出し 1〜6 が本文と同じ大きさ・太さで描かれる。docx ライブラリの既定のスタイル定義がフォントしか指定していないため。A-1（組み込みスタイルに対応させ、ナビゲーションウィンドウに出す）は満たしているが、見た目の調整はテンプレート・スタイルの扱いと合わせて決める

## 2026-11-18 フェーズ 3b の準備と実装

- 調べたこと: 既存の依存 `docx` に `docx/math` の `latexToMath`（LaTeX → OMML）があり、分数・根号・総和・積分・行列・cases・aligned・gather・split・アクセントなどが通った。A-11 の「LaTeX → MathML → OMML」と MathML → OMML の自作は不要になった。通らなかったのは `\sideset`・`\genfrac`・`\bbox`・`\ce`・CD 環境など
- ユーザー決定: `remark-math` を足して数式を構文解析し、変換できない式は MathJax の画像。Dataview も他のプラグインと同じく描画結果から取り込む（`api.query()` は使わない）。描画結果の HTML → mdast は自作。以降、フェーズの案は承認を待たずに記録して実装してよい（ユーザー指示）
- 作ったもの（`feat/plugin-render`）
  - コア: 描画結果の DOM → mdast（`dom-to-mdast.ts`）。組み立てに描画依頼・数式の検査と画像の代替・外部の画像・テーマのコールアウトの色を足した。.docx に数式（OMML）
  - Obsidian 側: `plugin-render.ts`（画面外での `MarkdownRenderer.render()` と完了待ち、SVG・canvas・img の画像化、MathJax、`requestUrl`、`--callout-color`）。開発用ビルドにテスト用のコードブロックの処理（`boe-test-svg`・`boe-test-canvas`）。設定に 2 項目
  - テスト用 Vault に `word3b/`
- 確認: 単体テスト 144 件（偽の DOM での変換 5 件、3b の要素 6 件、`word3b/` のスナップショット）。フェーズ 2・3a のスナップショットの変化は `10-unsupported` の `$E = mc^2$` が数式になった部分だけ。6 本の .docx の XML がすべて整形式。本番ビルドの `main.js` は 1.44 MB（+0.06 MB。KaTeX は含まれない）
- 残り: テスト用 Vault での手動確認（Dataview を入れて、開発用ビルドで）。Obsidian の中での描画・MathJax・テーマ色の読み取りは、単体テストでは確かめられない
- 手動確認で見つかった不具合: `mermaid/` を Word に変換すると、図が黒く塗りつぶされて見えない
  - 原因: いまの Obsidian の Mermaid は、色を CSS 変数で指定した SVG（`fill="var(--_fg)"`、`--_fg:var(--pele-fg,#1f1f1f)` など）を出す。Word の SVG の描画は CSS 変数を解釈しないので、塗りが既定の黒になる。PNG（ブラウザで描く）は正しかった
  - 修正: SVG の `var(--…)` を宣言の値か既定値に、`currentColor` を文字色に、文字列のまま置き換える（`src/core/svg-css.ts`）。Mermaid の SVG（.docx と保存する画像ファイルの両方）と、他のプラグインの描画結果の SVG にかける。古い SVG のキャッシュを使わないよう、キャッシュのキーに SVG の作り方の版を足した（画像ファイルの名前のハッシュも変わる）
  - 確認: 書き出された 23 図の SVG にかけて、`var(` が残らないことを確かめた。Word での見え方は手動確認で見る

## 2026-11-18 フェーズ 3a 完了（タグ 0.3.0）

- ユーザーがテスト用 Vault の `word3a/` の 11 本を Word と LibreOffice で開き、完了条件 A を確認した
- `release: 0.3.0` → `feat/word-elements` を main にマージ → タグ `0.3.0`。マージ後の main でビルド（1.38 MB）とテスト 127 件が通ることを確認
- 次: フェーズ 3b（数式・Dataview・他プラグインのコードブロック・HTML → hast → mdast の取り込み・外部画像のダウンロード・コールアウトのテーマ色）。始めるときに、05 のフロー図の未決事項（描画の完了待ち・結果の形など）と、数式の OMML 化のめどを決める

## 2026-11-18 フェーズ 3a の実装

- 作ったもの（`feat/word-elements`）
  - コア: コメントの除去（`comments.ts`）、Obsidian 独自の記法の変換（`obsidian-syntax.ts`: Wikilink・Markdown のリンクと画像・参照形式のリンク・ブロック ID・コールアウト・インライン脚注・HTML）、ノートの組み立て（`note-assembly.ts`: 埋め込みの展開・Mermaid の連番・リンクの解決・画像と色付けの準備）、frontmatter → 文書プロパティ（`frontmatter.ts`）。.docx のレンダラにブックマーク・内部リンク・画像・コールアウト・色付きのコード・脚注・Word のコメント・HTML の書式・改ページ・作成日時を足した
  - Obsidian 側: `vault-env.ts`（`getFirstLinkpathDest`・画像の読み込みと canvas での PNG 化・`loadPrism()`・`metadataCache` の frontmatter）。設定に 3 項目（コードの行番号・コメントを Word のコメントに・プロパティの表）
  - テスト用 Vault に `word3a/`（サンプル 11 本、埋め込み用の `parts/`、画像などの `attachments/`）。画像などは `scripts/make-word3a-assets.py` で作った
- 途中で直したこと
  - コードの色付けで改行を独立した `w:r` にしていたため、色のないコードでもフェーズ 2 と XML が変わった。行の最初の断片に改行を付ける形にして、色がなければフェーズ 2 と同じ XML に戻した
  - コメントを Word のコメントにしない設定でも、消したコメントの中身を `comments.xml` に書いていた。設定がオンのときだけ持つようにした
  - Markdown 形式の画像が見つからないとき、原文ではなくファイル名だけが残っていた。原文 `![alt](url)` を残すようにした
- 確認: 単体テスト 127 件（`word3a/` のスナップショットは document.xml と警告の一覧の 2 つずつ）。フェーズ 2 のスナップショットの変化は、08（JS のコードに色）・09（内部リンクがリンクに）・10（画像・脚注・HTML・コメント）だけで、どれも 3a の変更どおり。11 本の .docx の XML がすべて整形式。本番ビルドの `main.js` は 1.38 MB（フェーズ 2 から +0.03 MB。新しい依存はない）
- 残り: テスト用 Vault での手動確認（完了条件 A）、リリース 0.3.0・マージ・タグ

## 2026-11-18 フェーズ 3 の準備（3a の決定事項と完了条件を確定）

- ユーザー決定: フェーズ 3 を 3a（`0.3.0`）と 3b（`0.3.1`）に分ける。Wikilink・コールアウトは変換の段で扱う（A-0a の「micromark 拡張」の記述を G2 に合わせて修正）。埋め込んだノートの見出しは元のレベルのまま
- 3a の範囲: 内部リンク・ブロック ID・ノート埋め込み・画像・PDF 等・コールアウト・コードの色付け・脚注・コメント・frontmatter・インライン HTML と改ページ。3b: 数式・Dataview・他プラグインのコードブロック・HTML の取り込み・外部画像のダウンロード・コールアウトのテーマ色
- そのほかの論点は Claude 推奨で決めた（requirements.md「フェーズ 3 の決定事項」）。作業ブランチは `feat/word-elements`

## 2026-11-18 フェーズ 2 完了（タグ 0.2.0）

- ユーザーがテスト用 Vault の `word/` の 11 本を Word と LibreOffice で開き、完了条件 A〜C を確認した
- `release: 0.2.0` → `feat/docx-basic` を main にマージ → タグ `0.2.0`。マージ後の main でビルド（1.35 MB）とテスト 97 件が通ることを確認
- 次: フェーズ 3（Word の要素の拡充: リンク・ノート埋め込み・画像・コールアウト・コードの色付け・脚注・数式・frontmatter・コメントの削除・他プラグインの記法）。始めるときに、Wikilink・コールアウトを構文解析と変換のどちらの段で扱うかを決める

## 2026-11-18 フェーズ 2 の実装

- 作ったもの（`feat/docx-basic`）
  - コア: 構文解析と変換の段（`src/core/markdown.ts`。remark-gfm・remark-frontmatter、変換の配列: Mermaid の連番・ハイライト・タスクの独自の状態・未対応の印付け）、.docx のレンダラ（`src/core/docx-render.ts`）、ノート 1 件の変換とドライラン（`src/core/docx-export.ts`）
  - Obsidian 側: 実行の流れを「Mermaid 画像」と「Word」の 2 つのモードで共用する形にした（`export-runner.ts`）。右クリックとコマンドに「Word に変換」を足し、設定画面に Word の節を足した
- 途中で直したこと
  - スナップショットが毎回変わる問題: docx ライブラリがハイパーリンクの関係 ID をランダムに作り、画像の docPr の ID を通し番号で振るため。テスト側で比較の前にそろえるようにした
  - Mermaid の取り出しと連番付けで構文解析器が違うと連番がずれるおそれがあったので、`parseMarkdown` と `visitMermaidCodes` に一本化した
- 確認: 単体テスト 97 件（うちスナップショット 11 件、3 回続けて実行して安定）。11 本のサンプルを .docx にして中の XML がすべて整形式であることを確認。LibreOffice が手元にないため、開けるかどうかは手動確認で見る。本番ビルドの `main.js` は 1.35 MB
- 残り: テスト用 Vault での手動確認（完了条件 A〜C）、マージとタグ 0.2.0

## 2026-11-18 フェーズ 2 の決定事項と完了条件を確定、実装を開始

- 範囲: 見出し・段落・リスト・表・文字書式・Mermaid の埋め込みに加え、ユーザー決定で引用・コードブロック（色付けなし）・水平線・外部リンクを前倒しした。コメント `%%…%%` の削除はフェーズ 3 のまま
- そのほかの論点は Claude の推奨案で決めた（requirements.md「フェーズ 2 の決定事項」）。R4 の画像の最大高さを「本文の高さ」に確定した
- 完了条件 A〜E を requirements.md に追加した。作業ブランチは `feat/docx-basic`
- 依存の追加: `remark-gfm` 4.0.1・`remark-frontmatter` 5.0.0（どちらも MIT）

## 2026-11-18 フェーズ 2 の準備を開始

- フロー図 04・05・07 の未決事項（計 48 件）から、フェーズ 2 の範囲（見出し・段落・リスト・表・文字書式・Mermaid の埋め込み）に関わるものを絞り込んだ。リンク・画像・テンプレート・数式・他プラグインの記法・結合出力に関わる論点は、フェーズ 3〜5 に回す
- 気づいた点: `settings.md` で「実装: 1」にしていた `saveImageFiles`（変換時に画像ファイルも保存する）は、Word への変換がないと意味を持たないため、フェーズ 1 では実装していない。フェーズ 2 で実装する
- 作業記録としてこのファイルを作った

## 2026-11-18 フェーズ 1 完了（タグ 0.1.0）

- 作ったもの: 「Mermaid 画像として保存」（R1 の単独保存）。R2 の 4 つの起動方法、確認画面（ドライラン）、1 件ずつの保存（進捗・中断・タイムアウト）、Mermaid の PNG / SVG 化と専用キャッシュ、一時ファイル → rename の書き込み、結果レポート、出力マニフェスト
- 決めたこと: 専用キャッシュ、ミラー出力・上書きの既定値、直接選んだノートへの glob の扱い（ユーザー決定）ほか（requirements.md「フェーズ 1 の決定事項」）
- 確認: 単体テスト 65 件。ユーザーがテスト用 Vault で手動確認 A1〜E2 を実施。`main.js` 1.18 MB
- コミット: `a14acf0`〜`2ffdd51`（マージ `1bce07f`）

## 2026-11-18 フェーズ 0 完了（タグ 0.0.1）

- 作ったもの: TypeScript + esbuild + Vitest の雛形、manifest（`minAppVersion` 1.15.1）、設定画面の骨組み、英語・日本語の UI リソース、テスト用 Vault（Mermaid 23 図種）、設定一覧・依存一覧・開発手順
- 確認: `exceljs` が Obsidian（Electron のレンダラプロセス）で動くことを、開発用コマンドで確認（G3・G4 の要検証を解消）
- コミット: `bac31a3`〜`93c6206`（マージ `59c3a5b`）

## 2026-11-17〜18 要件と設計

- 要件を `docs/requirements.md`（旧 ideas.md）にまとめ、全体のコンポーネント図と 10 本の処理フロー図を作った
- フロー図を並列に作った結果の境界の食い違いを点検し、D1〜D7（キャンセルの範囲、AbortSignal、出力単位の受け渡し、マニフェストを読む時点、結果の単位、形式ごとの出力単位、グループの完成の指示）を決めた
