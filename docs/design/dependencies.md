# 依存ライブラリとライセンス

最終更新: 2026-11-18（フェーズ 0 で作成、フェーズ 1・2 で追加した依存を反映）

G1 の条件: 配布物に含めるライブラリは、再配布できるライセンス（MIT / Apache-2.0 等）に限る。依存を足すたびにこの表を更新し、コミットの本文にライセンスを書く（`docs/process/git-rules.md` の 3 章）。

## 配布物（main.js）に含めるもの

| パッケージ | バージョン | ライセンス | 用途 | 要件 |
|---|---|---|---|---|
| `docx` | 9.15.4 | MIT | .docx の生成 | G3 |
| `exceljs` | 4.4.0 | MIT | .xlsx の生成。esbuild は `browser` フィールドのビルド（`dist/exceljs.min.js`）を使う | G3 |
| `unified` | 11.0.5 | MIT | 構文解析の枠組み（G2） | G2 |
| `remark-parse` | 11.0.0 | MIT | Markdown → mdast（G2） | G2 |
| `remark-gfm` | 4.0.1 | MIT | 表・取り消し線・タスク・URL の自動リンク・脚注 | R5 |
| `remark-frontmatter` | 5.0.0 | MIT | frontmatter を本文から外す | R5 |
| `remark-math` | 6.0.0 | MIT | 数式 `$…$`・`$$…$$` の構文解析（フェーズ 3b）。LaTeX → Word の数式は `docx` の `docx/math`（`latexToMath`）で行う | R5 |
| `picomatch` | 4.0.7 | MIT | glob の判定（R2） | R2 |

上の 8 パッケージ自身と、そこから辿れる間接的な依存（計 265 件、`node_modules` 上で確認・フェーズ 3b 時点）のライセンスは次のとおり。いずれも G1 の条件を満たす。

- フェーズ 3b で増えたのは `remark-math`・`mdast-util-math`・`micromark-extension-math`・`unist-util-remove-position`・`katex`・`commander`・`@types/hast`・`@types/katex` の 8 件（すべて MIT）。`katex` は `micromark-extension-math` の HTML 出力用の依存で、構文解析だけを使う main.js には含まれないことを確かめた（main.js に `katex` の文字列がない）

| ライセンス | 件数 | 備考 |
|---|---|---|
| MIT（MIT/X11 と、オブジェクト形式で MIT と書かれた `format` を含む） | 244 | |
| ISC | 12 | |
| Apache-2.0 | 2 | |
| BSD-3-Clause | 2 | |
| (MIT OR GPL-3.0-or-later) | 1 | `jszip`。MIT を選んで使う |
| (MIT AND Zlib) | 1 | |
| BlueOak-1.0.0 | 1 | `graceful-fs`。許容型のライセンス |
| Unlicense | 1 | `big-integer`。パブリックドメイン相当 |
| 記載なし | 1 | `buffers@0.1.1`。exceljs の Node.js 向けの依存で、ブラウザ向けビルドを使う main.js には含まれない想定（要確認） |

## 開発だけに使うもの（配布物に含めない）

| パッケージ | バージョン | ライセンス | 用途 |
|---|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 | 型チェック（`npm run typecheck`）。7.x はネイティブ実装の新しい版のため、互換性を優先して 5.x にした |
| `esbuild` | 0.28.2 | MIT | バンドル |
| `vitest` | 5.1.0 | MIT | 単体テスト（G5） |
| `obsidian` | 1.14.4 | MIT | Obsidian API の型定義（実行時は Obsidian が提供する） |
| `@types/node` | 22.x | MIT | Node.js の型定義 |
| `tslib` | 2.9.1 | 0BSD | TypeScript の補助関数 |
| `jszip` | 3.10.2 | (MIT OR GPL-3.0-or-later) | テストで .docx / .xlsx を展開して中身を確かめる |

変換結果の一覧ページ（`scripts/preview-export.py`）が使う Python のパッケージ。npm の依存ではなく、使う人が各自で入れる。配布物にもリポジトリにも含めない。

| パッケージ | 確認した版 | ライセンス | 用途 |
|---|---|---|---|
| `pywin32` | 306 | PSF | Word / Excel の COM オートメーション（PDF 化） |
| `PyMuPDF` | 1.27.2.3 | AGPL-3.0 または商用 | PDF → PNG。手元で動かす開発用の道具としてだけ使い、配布しない |
| `Pillow` | 12.3.0 | MIT-CMU | PNG の読み書き |
| `numpy` | 2.4.2 | BSD-3-Clause ほか | ピクセル単位の比較 |

## 既知の脆弱性の警告（npm audit・2026-11-18）

- `exceljs` が依存する `uuid`（< 11.1.1）に moderate の警告がある（GHSA-w5hq-g745-h8pq: v3/v5/v6 で `buf` 引数を渡したときの境界チェック漏れ）。`npm audit fix --force` は `exceljs` を 3.4.0 に下げる破壊的変更になるので適用しない。exceljs が使うのは v4 の UUID 生成で、該当する呼び出し方ではない（要確認）
- G3 の保守状況のリスク（exceljs の更新がほぼ止まっている）と合わせて、フェーズ 4（Excel）を始めるときに見直す
