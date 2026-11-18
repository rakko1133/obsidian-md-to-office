# 設定の一覧

最終更新: 2026-11-18（フェーズ 4a・4b の Excel の設定を反映）
段階: フェーズ 0 で作成（G5・完了条件 E1）。「実装」が 0 と 1 の項目はフェーズ 1 までに実装する。既定値はフェーズ 1 の決定事項（requirements.md）を反映済み

- 設定値は `data.json` に保存する。型と既定値の実装は `src/core/settings.ts`、画面は `src/obsidian/settings-tab.ts`
- キーは英語の camelCase。表示名は i18n のリソース（`src/i18n/`）に置く
- 「実装」はロードマップのフェーズ番号。要件の正本は `docs/requirements.md` で、この表と食い違ったら要件を優先し、この表を直す
- 実行ごとに選ぶもの（出力形式・結合出力）は、対象確認モーダル（R2）で選ぶ。ここにはその初期値だけを置く
- 「未決」は、要件に既定値や値の形が書かれていないもの。そのフェーズを始めるときに決める

## 出力の基本（R8・G4・R3）

| キー | 値 | 既定値 | 要件 | 実装 |
|---|---|---|---|---|
| `outputLocation` | `vault` / `external` | `vault` | G4 | 1 |
| `outputRoot` | Vault 内のフォルダのパス | `_export` | G4, R8 | 0 |
| `externalOutputRoot` | Vault 外の絶対パス | 空（未設定） | G4 | 1 |
| `saveMode` | `mirror`（ミラー出力）/ `sameFolder`（同一フォルダ） | `mirror` | R1, R8 | 1 |
| `defaultFormat` | `word` / `excel` / `both` | `word` | R8 | 4b |
| `onConflict` | `overwrite` / `skip` / `rename`（連番） | `overwrite` | R3 | 1 |
| `onError` | `continue` / `failFast` | `continue` | R3 | 1 |
| `timeoutSeconds` | 正の整数（秒） | `30` | R3 | 1 |
| `saveImageFiles` | 真偽値（変換時に画像ファイルも保存する） | `false` | R8 | 2 |
| `authorName` | 文字列（文書プロパティの作成者名） | 空 | C-8, D-5 | 2 |

## 対象の選び方（R2）

| キー | 値 | 既定値 | 要件 | 実装 |
|---|---|---|---|---|
| `includeGlobs` | glob パターンの配列 | 空（すべて含める） | R2 | 1 |
| `excludeGlobs` | glob パターンの配列 | `["**/*.excalidraw.md"]` | R2 | 1 |

frontmatter の `export: false` による除外は常に有効で、設定は持たない（R2）。

## Mermaid の画像（R1・R4）

| キー | 値 | 既定値 | 要件 | 実装 |
|---|---|---|---|---|
| `mermaidImageFormat` | `svg` / `png` / `both`（画像ファイルとして保存する形式） | `png` | R1 | 1 |
| `pngDpi` | 正の整数 | `192` | R4 | 1 |
| `pngTransparentBackground` | 真偽値 | `false` | R4 | 1 |
| `mermaidFontFamily` | CSS の font-family | `"Yu Gothic", "YuGothic", "Hiragino Sans", "Meiryo", sans-serif` | R4 | 1 |
| `figureCaptions` | 真偽値（図番号キャプションと代替テキスト） | `false` | R4, C-4b | 2 |

テーマは `neutral` に固定し、設定は持たない（R4）。

## Word の要素（R5）

| キー | 値 | 既定値 | 要件 | 実装 |
|---|---|---|---|---|
| `fileNameAsTitle` | 真偽値（見出しを 1 段下げ、ファイル名を「表題」にする） | `false` | A-1 | 2 |
| `strictLineBreaksFallback` | 真偽値（Obsidian の設定が読めないときの「厳密な改行」） | `false` | A-2 | 2 |
| `calloutColorSource` | `fixed`（既定色の固定表）/ `theme`（テーマの `--callout-color`） | `fixed` | A-6 | 3b |
| `codeLineNumbers` | 真偽値 | `false` | A-7 | 3a |
| `keepCommentsAsWordComments` | 真偽値（`%%…%%` を Word のコメントにする） | `false` | A-16 | 3a |
| `downloadExternalImages` | 真偽値（1 枚 20 MB まで） | `false`（リンクのみ） | A-20 | 3b |
| `frontmatterPropertyMap` | frontmatter のキー → 文書プロパティの対応 | 既定の対応（`title` → タイトル、`author` → 作成者、`tags` → キーワード、`created` → 作成日時、それ以外 → ユーザー設定のプロパティ）。3a では設定画面を作らない | A-27 | 未定 |
| `frontmatterTable` | 真偽値（冒頭にプロパティの表を出す） | `false` | A-27 | 3a |

## Word の体裁（R6）

| キー | 値 | 既定値 | 要件 | 実装 |
|---|---|---|---|---|
| `wordTemplatePath` | .docx / .dotx のパス | 空（内蔵の既定スタイル） | C-1b | 3 |
| `headingNumbering` | 真偽値 | `false` | A-1, C-1c | 3 |
| `paperSize` | `A4` / `B5` / `Letter` | `A4` | C-2 | 2 |
| `marginsMm` | 上・下・左・右（mm） | 各 `25` | C-2 | 2 |
| `orientation` | `portrait` / `landscape` | `portrait` | C-2 | 2 |
| `pageBreakBeforeH1` | 真偽値 | `false` | C-2 | 3 |
| `bodyFontEastAsia` / `bodyFontLatin` | フォント名 | `游明朝` / `Century` | C-3 | 2 |
| `headingFontEastAsia` / `headingFontLatin` | フォント名 | `游ゴシック` / `Arial` | C-3 | 2 |
| `tableOfContents` | 真偽値 | `false`（結合出力では `true`） | C-4a | 5 |
| `tableCaptions` | 真偽値（画像の「図 n」と表の「表 n」） | `false` | C-4b | 5 |
| `footerPageNumber` | 真偽値 | `true` | C-5 | 5 |
| `headerTitle` | 真偽値 | `false` | C-5 | 5 |
| `tableFullWidth` | 真偽値（表を本文の幅いっぱいにする） | `false`（内容に合わせる） | C-6 | 3 |
| `combineOrder` | `fileName` / `frontmatterOrder` / `moc` | `fileName` | C-8 | 5 |
| `coverPage` | 真偽値 | `false` | C-8 | 5 |
| `defaultCombine` | 真偽値（対象確認モーダルの結合出力の初期値） | `false` | C-8 | 5 |

## Excel（R7・A-30〜A-34・R8）

| キー | 値 | 既定値 | 要件 | 実装 |
|---|---|---|---|---|
| `excelBookUnit` | `perFolder`（1 フォルダ = 1 ブック）/ `perNote`（1 ノート = 1 ブック） | `perFolder` | R8 | 4a |
| `excelSheetUnit` | `perNote`（1 ノート = 1 シート）/ `perTable`（1 表 = 1 シート） | `perNote` | A-31, D-1 | 4a |
| `excelOutlineMode` | 真偽値（アウトライン形式） | `false`（表だけを抜き出す） | A-30 | 4b |
| `excelAsTable` | 真偽値（Excel テーブルとして出力） | `true` | D-3 | 4a |
| `excelSourceColumns` | 真偽値（「元ノート」「見出し」の列を付ける） | `false`（集計では常に付ける） | D-5 | 4b |

単一ノートの変換は `excelBookUnit` に関係なく `{ノート名}.xlsx` になる（R8: 実行する件数が 1 件のとき）。

## 設定を持たないと決めたもの

- Mermaid のテーマ（`neutral` 固定: R4）
- frontmatter の `export: false` による除外（常に有効: R2）
- 画像の配置（「行内」に固定: C-7）
