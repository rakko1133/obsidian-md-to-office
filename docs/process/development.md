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
| `npm run build` | 型チェックのあと本番ビルドを作る（圧縮あり、開発用のコマンドなし、末尾に同梱の依存のライセンス文）。`THIRD_PARTY_NOTICES.md` が古ければ止まる。`main.js` の大きさを表示する |
| `npm run notices` | 本番ビルドに入る依存のライセンス文を `THIRD_PARTY_NOTICES.md` に書き直す。依存を足す・上げるたびに実行する（`npm run notices:check` は確かめるだけ） |
| `npm run typecheck` | 型チェックだけをする |
| `npm run lint` | Obsidian 公式の `eslint-plugin-obsidianmd` の推奨設定で `src/` を検査する（コミュニティプラグインの自動レビューと同じ観点）。リリースの前にエラーが 0 件であることを確かめる |
| `npm test` | Vitest の単体テストを実行する |
| `npm run deploy:test-vault` | ビルド結果（`main.js`・`manifest.json`）をテスト用 Vault のプラグインフォルダにコピーする |
| `npm run preview:export` | `test-vault/_export` の .docx / .xlsx を PDF → PNG にし、基準画像と比べた一覧ページ `.preview/index.html` を作る |
| `npm run preview:approve` | 今回の PNG を基準画像（`.preview/baseline/`）として登録する |
| `npm run obsidian:run -- --mode xlsx --path excel` | 開いている Obsidian（開発用ビルド）に変換を頼み、結果を表示する。画面は操作しない（下の「画面を操作せずに Obsidian で確かめる」） |

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

## 画面を操作せずに Obsidian で確かめる（開発用の自動実行）

Obsidian の中でしか確かめられない処理（Mermaid・描画の取り込み・実際の変換）を、画面を操作せずに試す。Claude Code が確認している間も、PC で他の作業ができる。開発用ビルド（`npm run build:dev`）にだけ入り、本番ビルドには入らない（`src/obsidian/dev-automation.ts`）。

1. Obsidian でテスト用 Vault を開いておく（後ろや最小化でよい）。初回だけ、開発用ビルドを配置してからプラグインを無効 → 有効にする
2. `npm run build:dev` → `npm run deploy:test-vault`。プラグインが `main.js` の変化に気づいて、自分で読み込み直す（数秒）
3. `npm run obsidian:run -- --mode xlsx --path excel`（`--mode` は `mermaid` / `docx` / `xlsx` / `pdf` / `both` / `office`（`office` は設定 `defaultFormats` の形式。`--set 'defaultFormats=["word","pdf"]'` で組み合わせを試せる）、`--path` は複数可で空文字は Vault 全体、`--set excelSheetUnit=perTable` でこの実行だけ設定を変える）
   - `--select excel/01-types.md`（複数可）で、確認画面でチェックを残すノートを指定する（省略するとすべて）。`--plans` で確認画面に出す予定（出力ファイル）を表示し、実際に書き込んだ出力と食い違えば `MISMATCH` を出す
4. 確認画面と結果画面は出さずに変換し、結果（ノートごとの状態・出力ファイル・警告）を表示する。続けて `npm run preview:export` で見た目を確かめる

設定画面は `--mode settings` で確かめる（変換はしない。`src/obsidian/dev-settings.ts`）。設定画面を開き、行ごとの名前・説明・表示されているか・入力欄の値を JSON で出す。

- `--action "行の名前[#同名の何番目][:入力欄の番号]=値"`（複数可）で入力欄に値を入れ、操作ごとに保存された設定と表示されている行を記録する。トグルは `true` / `false`
  - 例: `npm run obsidian:run -- --mode settings --action "出力先=external" --action "余白（mm）: 上, 下, 左, 右#1:3=12"`（2 つ目の「余白」の行は PDF の余白）
- 行の名前は Obsidian の表示言語のとおりに書く
- 終わると設定を元に戻し、設定画面を閉じる。設定画面は Obsidian の画面に一瞬開く

- 仕組み: プラグインのフォルダ（`test-vault/.obsidian/plugins/batch-office-export/`）に `dev-request.json` を置くと、プラグインが 1 秒ごとに見つけて実行し、`dev-result.json` に結果を書く。読み込んだときに `dev-status.json`（読み込んだ日時・`main.js` の更新日時）を書く。`--wait-reload` は読み込み直しを待つだけ
- 設定の上書きはその実行だけで、保存しない
- テスト用 Vault には開発用ビルドを置いたままにする（2026-11-18 から）。本番ビルドには自動の読み込み直しがないので、本番ビルドを置くと、次に開発用ビルドを置いたときに画面でプラグインを無効 → 有効にし直す必要が出るため。本番ビルドが読み込めることは、マージの後に `npm run build` で作った `main.js` を Node.js で読み込んで確かめる

## 処理時間の計測（高速化の検討）

開発用の自動実行に `--profile` を付けると、段ごとの処理時間（回数・合計・平均・最大、ms）を表にする。例: `npm run obsidian:run -- --mode docx --path word3a --profile`

- 計測点は `src/core/profile.ts` の `timed`（非同期）・`timedSync`（同期）で包んだ処理。ラベルは `段/細かい段`（例: `docx/prepare/assemble`、`mermaid/svgToPng/toBlob`）。入れ子の時間は親にも含まれる（包含時間）
- 計測は `--profile` を付けた実行の間だけ。それ以外では包んだ処理をそのまま呼ぶ
- Mermaid のキャッシュの影響を除くときは、先に `test-vault/.obsidian/plugins/batch-office-export/cache/mermaid/` を消す
- Obsidian を後ろに置いたままだと、`canvas.toBlob` など描画のフレームに頼る処理が遅く出ることがある（2026-11-19 の作業記録）

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

## 公開とリリースの手順

Obsidian のコミュニティプラグインは、`manifest.json` の `version` と同じ名前の GitHub Release から `main.js`・`manifest.json`・`styles.css` を取得する。リポジトリの公開・push・Release の作成・申請は外部に公開する操作なので、ユーザーの指示を受けてから行う。

1. `manifest.json`・`package.json` の `version` と `versions.json` を上げて `release: x.y.z` をコミットし、`main` にマージして注釈付きタグ `x.y.z` を付ける（`git-rules.md` の 4 章）
2. `npm run lint`（エラー 0 件）・`npm run notices:check`・`npm test` が通ることを確かめ、`npm run build` で本番ビルドを作る
3. `git push origin main x.y.z`
4. `gh release create x.y.z main.js manifest.json styles.css --title x.y.z --notes "<変更点>"`（初回はリポジトリを公開に切り替えてから: `gh repo edit --visibility public --accept-visibility-change-consequences`）
5. 作業が終わったら `npm run build:dev` と `npm run deploy:test-vault` で、テスト用 Vault を開発用ビルドに戻す（本番ビルドには開発用の自動実行が入っていない）

初回だけ、コミュニティプラグインに申請する（2026-11-18 時点の公式の手順。以前の `obsidianmd/obsidian-releases` への PR ではなくなった）:

1. [community.obsidian.md](https://community.obsidian.md) に Obsidian のアカウントでサインインし、プロフィールに GitHub のアカウントをつなぐ（リポジトリの持ち主かを確かめるため）
2. プラグインを追加する（リポジトリ `rakko1133/obsidian-md-to-office`）。ディレクトリは既定のブランチの先頭の `manifest.json` を読み、その `version` の GitHub Release から配布物を取る
3. 自動レビューの指摘が出たら、直して版を上げた Release を出す。エラーが残っている間は Obsidian からインストールできない

自動レビューの前に `npm run lint`（公式の ESLint プラグイン `eslint-plugin-obsidianmd` の推奨設定、`eslint.config.mjs`）で `src/` を検査しておく。1.0.2 の時点でエラーは 0 件、警告 8 件（docx の `TextRun` の `bold` などを `String.prototype.bold` と取り違える誤検出、設定画面の宣言的 API への移行）。

自動レビューは ESLint のほかに、本番ビルドの main.js を静的に調べる（script 要素を作る、`eval`・`new Function`、`main.js`・`manifest.json` の文字列と ZIP の展開とファイルの書き込みの組み合わせ、など）。リリースの前に本番ビルドで次の文字列が 0 件であることを確かめる: `createElement("script")`・`new Function`・`manifest.json`・`main.js`（`grep -o -F '<文字列>' main.js | wc -l`）。exceljs の同梱ビルドの該当箇所は `scripts/patch-exceljs.mjs` がビルド時に取り除く

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

## フェーズ 7 の確認（PDF 出力・完了条件 A〜F）

PDF は `npm run preview:export` の対象外（Word / Excel を PDF にする道具のため）。PyMuPDF でページ数・しおり・リンク・文書プロパティを読み、ページを画像にして確かめた。

- [x] 1 ノート = 1 PDF（2026-11-19 Claude が自動実行で確認）: `npm run obsidian:run -- --mode pdf --path word3a --path word3b --path mermaid`。46 件すべて成功。数式・Dataview・Mermaid（全図種）・画像・コールアウト・コードの色付け・脚注が表示どおり。しおりとフッターの「n / 総ページ数」が入る
- [x] ダークテーマ: 実行の間だけライトテーマになり、PDF は明るい色。実行の後は元のテーマに戻る（一時的なコードで body をダークにして確認）
- [x] 結合出力: `--mode pdf --path combine --combine --set coverPage=true --set headerTitle=true --set combineOrder=moc`。`combine.pdf`（表紙・目次・3 章）と `sub/sub.pdf`。MOC の順、しおりの 1 段目がノート名、表紙にヘッダー・フッターが出ない、目次から本文へ飛べる、別のフォルダの PDF へのリンク（`sub/sub.pdf`・`../word3a/01-internal-links.pdf`）
- [x] ページ設定: `--set pdfPaperSize=A3 --set pdfOrientation=landscape --set pdfScale=150` で 420×297mm。同名ファイルの `skip`・`rename`（`01-math (1).pdf`）
- [x] 形式の組み合わせ: `--mode office --set 'defaultFormats=["word","excel","pdf"]'` で .docx・.xlsx・.pdf が同時にできる
- [x] 確認画面（一時的なコードで DOM を読み出して確認）: Word / Excel / PDF のチェックボックスと結合出力。形式を変えると題名（「PDF に変換」「Word / PDF に変換」）と予定が変わる
- [ ] 設定画面の PDF の区分の見た目（画面での確認はしていない）

## フェーズ 5b の手動確認（完了条件 A）

開発用の自動実行で確かめる。サンプルは `test-vault/style/`（見出し 1〜6・図・画像・表の `01-style.md`、Word で作ったテンプレート `templates/red-headings.dotx`: 見出し 1 が赤、見出し 2 が紺）。

- [x] 見出しのスタイル（2026-11-18 Claude が確認）: `--mode docx --path word/01-headings.md`。見出しが大きさと太さで区別できる
- [x] 体裁をすべてオン: `--mode docx --path style/01-style.md --set headingNumbering=true --set pageBreakBeforeH1=true --set tableFullWidth=true --set figureCaptions=true --set tableCaptions=true`。段落番号（2 つ目の見出し 1 は「2」）、2 つ目の見出し 1 の前で改ページ、表の幅 100%、図 1〜3（Mermaid の title・代替テキスト・直前の見出し）、表 1（表の上）
- [x] テンプレート: `--set wordTemplatePath=style/templates/red-headings.dotx`。見出し 1 が赤、見出し 2 が紺。ないパスを指定すると実行の警告が出て、内蔵のスタイルで変換される
- [x] 結合出力との組み合わせ: `--mode docx --path combine --combine` に段落番号・図表番号・テンプレート。章が 1〜4、図表番号は章をまたいで通し番号

## フェーズ 5a の手動確認（完了条件 A）

開発用の自動実行で確かめる。サンプルは `test-vault/combine/`（MOC `combine.md`、`order` 付きの 2 本、表と図の 1 本、サブフォルダ `sub/`）。

- [x] 結合出力の見た目（2026-11-18 Claude が確認。テストと同じ部品で作った .docx を Word で描画）: 表紙（MOC の title / author / date、ヘッダー・フッターなし）、目次（開いたときに更新され、章と見出しとページ番号が入る）、章が並び順どおりで改ページ、ヘッダーのタイトル、フッターの「n / 総ページ数」、章ごとの脚注、章の間のリンク
- [x] Obsidian での結合出力（2026-11-18 Claude が自動実行で確認）: `npm run obsidian:run -- --mode docx --path combine --combine`（`--set combineOrder=moc --set coverPage=true --set headerTitle=true` も）。`combine.docx` と `sub/sub.docx` ができ、実際の Mermaid の図が章ごとに入る。別のフォルダのノートへのリンクは、マニフェストに記録があれば .docx への相対リンク
- [x] 1 ノート = 1 .docx のフッターのページ番号（2026-11-18 Claude が確認）: `--mode docx --path word/01-headings.md` で「1 / 1」
- [x] 確認画面のチェックボックス（2026-11-18 Claude が画面で確認）: 「1 フォルダを 1 つの .docx にまとめる」が出て、オンにすると予定が `combine.docx` と `sub/sub.docx` の 2 つになる。形式を Excel にすると隠れる

## フェーズ 4b の手動確認（完了条件 A）

開発用の自動実行で確かめる（画面は操作しない）。`npm run build:dev` → `npm run deploy:test-vault` → 次のコマンド → `npm run preview:export`。

- [x] アウトライン形式（2026-11-18 Claude が確認）: `npm run obsidian:run -- --mode xlsx --path excel/outline --set excelOutlineMode=true`。見出しが H1・H2・H3 の列に分かれ、H4 とコードは本文の列。リストの字下げ、☐ / ☑、表は本文の列から右へ。行のグループ化で折りたためる。Excel で開ける
- [x] 「元ノート」「見出し」の列: `--mode xlsx --path excel/01-types.md --set excelSourceColumns=true`。表の左に元ノート（リンク）と見出しの列
- [x] Vault 全体の集計: `--mode summary --path ""`。`_export/test-vault_集計.xlsx` に目次・プロパティ（1 ノート 1 行、期日は日付型）・タスク（Vault 全体、期日は日付型、優先度は別の列、ノートはリンク）・Dataview（結果の表を「ノート名: クエリ」の表題付きで）
- [x] 両方: `--mode both --path excel`。ノートごとの .docx と、フォルダごとの .xlsx の両方ができる
- [x] 確認画面の出力形式の選択（2026-11-18 Claude が画面で確認）: 右クリック「Office 形式に変換…」で、出力形式の初期値（Word）が選ばれた確認画面が出る。「Word と Excel の両方」に変えると、題名が「Word と Excel に変換」になり、予定が .docx とブックの両方に計算し直される
- [x] 本番ビルド（2026-11-18、0.4.1 のマージ後）: 本番ビルドを配置し、Node.js で（Obsidian と同じくグローバルに MathJax がある条件で）読み込めることを確かめた。Obsidian の中で本番ビルドに切り替わったことは画面では確かめていない。その後、テスト用 Vault には開発用ビルドを置き直した（Obsidian を次に起動したときに読み込まれる）

## フェーズ 4a の手動確認（完了条件 A）

準備: `npm run build:dev` → `npm run deploy:test-vault` → Obsidian でプラグインを無効 → 有効にする。サンプルは `test-vault/excel/`（5 本と、サブフォルダ `sub/`・埋め込み用の `parts/`）。フォルダ `excel` を右クリック →「Excel（.xlsx）に変換」。各 .xlsx を Excel で開くか、一覧ページ（`npm run preview:export`）で確かめる。

- [x] 出力（2026-11-18 Claude が Obsidian で変換して確認）: `_export/excel/excel.xlsx`・`parts/parts.xlsx`・`sub/sub.xlsx` の 3 つ。`04-no-table` はスキップ（表がない）。確認画面と結果の件数は、ブックの数で数える
- [x] 目次シート: 先頭にあり、各シートへのリンク・元ノート・見出し・表の数が並ぶ
- [x] `01-types`: 数値・桁区切り・パーセント・通貨（¥・$・円）・日付・日時・真偽値が型と表示形式になり、郵便番号・電話番号・先頭ゼロ・16 桁の数字・混在の列は文字列のまま。見出し行で固定され、印刷は横向き
- [x] `02-multi-tables`: 表が縦に並び、直前の見出し（コールアウトの中ではそのタイトル）が表題行になる。表ごとに別の Excel テーブル。空・重複の列名は「列1」「名前 (2)」
- [x] `03-cell-format`: 太字・斜体・取り消し線、等幅のコード、セル内の改行、リンク（外部・同じブックのシート・`obsidian://`）、セルの中の画像（幅 200 px まで）。`=SUM(A1:A3)` は文字のまま
- [x] `05-…`: シート名が 31 文字に切り詰められる
- [x] 設定を変えて確かめる（2026-11-18 Claude が確認）: 「シートの単位」を「1 表 = 1 シート」、「ブックの単位」を「1 ノート = 1 ブック」、「Excel テーブルにする」をオフにすると、表のある 6 ノートがそれぞれ `{ノート名}.xlsx` になり、シート名は直前の見出し（なければ「表 n」）、Excel テーブルはなくなる。確認の後、設定は既定に戻した
- [x] 確認の後、`npm run build` の本番ビルドに戻して配置する（2026-11-18、0.4.0 のマージ後に配置）

## フェーズ 3b の手動確認（完了条件 A）

準備: テスト用 Vault に Dataview プラグインを入れて有効にする（コミュニティプラグインから）。dataviewjs を確かめるには、Dataview の設定で「Enable JavaScript Queries」をオンにする（既定はオフ。オフのままなら dataviewjs は描画できなかったとして、コードのまま残って警告が出る）。`npm run build:dev`（テスト用のコードブロックの処理を登録する開発用ビルド）→ `npm run deploy:test-vault` → Obsidian でプラグインを無効 → 有効にする。サンプルは `test-vault/word3b/`（6 本と、Dataview の対象の `data/`）。フォルダ `word3b` を右クリック →「Word（.docx）に変換」。各 .docx を Word で開くか、一覧ページ（`npm run preview:export`）で確かめる。

- [x] `01-math`（2026-11-18 Claude が Obsidian で変換し、Word で確認）: インラインとブロックの数式が Word の数式になる（数式をクリックすると Word の数式ツールで編集できる）。分数・根号・総和・積分・極限・行列・場合分け・aligned・記号。`\sideset` と `\genfrac` の式は画像になり、`\undefinedcommand` は LaTeX のまま残る。レポートに警告が 3 件出る。コードの中の `$x$` は数式にならない
- [x] `02-dataview`（2026-11-18 Claude が Dataview 0.5.68 を入れて確認）: TABLE が表（「データ A」のリンクをクリックすると `data/データ A.docx` が開く）、LIST がリスト、TASK が ☐ ☑ 付きのリスト、dataviewjs の見出し・段落・表が入る。インラインのクエリは文字のまま。Dataview を無効にして変換すると、コードのまま残って警告が出る
- [x] `03-plugin-blocks`（2026-11-18 Claude が確認）: テスト用の SVG の図と、少し遅れて描かれる canvas の図（と、その下の段落）が画像として入る。登録のない言語はコードのまま。Mermaid は図になる
- [x] `04-external-images`（2026-11-18 Claude が確認。Wikipedia のロゴはサムネイルの URL が 400 を返すようになったので、元の SVG の URL に変えた）: 設定「外部の画像をダウンロードする」がオフならリンク、オンなら画像が入る（Wikipedia のロゴは幅 120）。見つからない画像はリンクのまま残って警告が出る
- [x] `05-callout-theme`（2026-11-18 Claude が確認）: 設定「コールアウトの色」を「使っているテーマの色」にし、テーマか CSS スニペットで色を変えて変換すると、その色になる
  - スニペットの例（`test-vault/.obsidian/snippets/` に置き、設定 → 外観 → CSS スニペットで有効にする）: `.callout[data-callout="note"] { --callout-color: #d600d6; }`。Obsidian 1.15 の `--callout-color` は色そのもの（`#…`・`rgb(…)`・`color-mix(…)`）を書く。古いテーマの `r, g, b` の形も読める
- [x] `06-all-in-one`（2026-11-18 Claude が確認）: コールアウトの中と表のセルの中の数式、Dataview の LIST が入る
- [x] 確認の後、`npm run build` の本番ビルドに戻して配置する（2026-11-18、0.3.1 のマージ後に配置）（本番ビルドにはテスト用の処理がない）

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
