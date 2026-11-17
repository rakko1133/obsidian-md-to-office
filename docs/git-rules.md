# Git 運用ルール（案・2026-11-17）

対象: Obsidian md → Word / Excel 一括変換プラグイン（`docs/ideas.md` のロードマップに沿って開発）

方針: 1人で開発し、最後に GitHub で公開する（G1）。ルールは「履歴から変更の理由を追えること」「`main` がいつでもビルドできること」「Obsidian のリリースの決まりに合わせること」の3点を満たす最小限にする。

---

## 1. リポジトリに入れるもの / 入れないもの

### 入れる（バージョン管理する）
| 対象 | 理由 |
|---|---|
| `src/` の TypeScript ソース | 本体 |
| `manifest.json` / `versions.json` | Obsidian がバージョンと対応 Obsidian バージョンを読む。リリースの正本 |
| `package.json` / `package-lock.json` | 依存のバージョンを固定し、同じビルドを再現する |
| `esbuild.config.mjs` / `tsconfig.json` / Vitest の設定 | ビルドとテストの再現 |
| `tests/` の単体テストと、期待値（fixture） | 回帰テスト |
| `test-vault/` のサンプルノート（.md）と画像 | 各フェーズの動作確認に使う（G5） |
| `docs/`（`ideas.md`、本ファイルなど） | 要件と判断の記録 |
| `styles.css`、README、LICENSE | 配布物・公開物 |

### 入れない（`.gitignore` に書く）
| 対象 | 理由 |
|---|---|
| `node_modules/` | `package-lock.json` から再生成できる |
| `main.js`（ビルド成果物） | ソースから生成できる。配布は GitHub Releases に添付する |
| `*.map`、`dist/`、`coverage/` | 生成物 |
| `.obsidian/workspace*.json` | 開いているタブなど、操作のたびに変わる状態 |
| `data.json`（プラグインの設定値） | 個人の設定。テスト用 Vault 内のものも含む |
| `test-vault/**/_export/` などの変換結果（.docx / .xlsx / Mermaid の PNG・SVG） | 実行するたびに生成されるバイナリ。差分を比較できない。`*.docx` / `*.xlsx` はリポジトリ全体で除外し、テストの期待値として入れる必要が出たときだけ `git add -f` で個別に追加する |
| `.env`、鍵・トークンの類 | 機密。現時点で使う予定はないが先に除外しておく |

---

## 2. ブランチ

| ブランチ | 用途 | ルール |
|---|---|---|
| `main` | 常にビルドとテストが通る状態 | 直接の作業は `docs:` と小さな修正に限る |
| `feat/<内容>` | 機能の追加（例: `feat/mermaid-export`、`feat/docx-table`） | 1ブランチ = 1つのまとまった機能。フェーズより小さく切る |
| `fix/<内容>` | 不具合の修正 | |
| `docs/<内容>` | 要件・設計の大きな見直し | 小さな追記は `main` に直接でよい |

- 作業ブランチは `main` から作り、終わったら `main` にマージして削除する
- マージ前に `npm run build` と `npm test` が通ることを確認する
- マージ方法: `git merge --no-ff`（機能のまとまりが履歴に残る）

---

## 3. コミット

### 単位
- 1コミット = 1つの論理的な変更。「何を・なぜ」を1行で書ける大きさにする
- ビルドが通らない状態でコミットしない（作業ブランチ上の途中経過は可。マージ前に整える）
- 書式だけの変更（整形）と、動作の変更を同じコミットに混ぜない
- `docs/ideas.md` の要件を変えたときは、その変更だけでコミットする（判断の記録として追えるようにする）

### メッセージの書式（Conventional Commits）
```
<type>(<scope>): <要約>

<本文: なぜ変えたか。必要なら要件番号（R1, G2 など）を書く>
```

| type | 使う場面 |
|---|---|
| `feat` | 機能の追加 |
| `fix` | 不具合の修正 |
| `docs` | 文書だけの変更 |
| `test` | テストの追加・修正 |
| `refactor` | 動作を変えない内部構造の変更 |
| `build` | ビルド設定・依存の変更（依存を足すときは本文にライセンスを書く: G5） |
| `chore` | その他の雑務（`.gitignore` など） |
| `release` | リリースのためのバージョン番号の更新 |

- scope（任意）: `mermaid` / `docx` / `xlsx` / `parser` / `settings` / `ui` など、変更した部分
- 要約: 日本語で、50文字程度まで。末尾に句点を付けない
- 例:
  - `feat(mermaid): Mermaid 図を PNG で単独保存する (R1)`
  - `build: exceljs を追加（MIT）`
  - `docs: R6 に和文フォントの既定値を追記`

---

## 4. バージョン番号とタグ

- 書式: セマンティックバージョニング `MAJOR.MINOR.PATCH`
- **タグ名は `manifest.json` の `version` と完全に同じにする。先頭に `v` を付けない**（例: `0.1.0`）。Obsidian のコミュニティプラグインは、この名前の GitHub Release から `main.js` / `manifest.json` / `styles.css` を取得するため
- 公開前（v1 未満）の番号の付け方: フェーズ N を完了し、テスト用 Vault で動作確認が済んだら `0.N.0` を付ける

| 時点 | バージョン |
|---|---|
| フェーズ0 完了（雛形） | `0.0.1` |
| フェーズ1〜5 完了 | `0.1.0` 〜 `0.5.0` |
| フェーズ途中の不具合修正 | `0.N.1`, `0.N.2` … |
| フェーズ6 完了・コミュニティプラグインへ申請 | `1.0.0` |

- バージョンを上げる手順: `manifest.json` と `package.json` の `version`、`versions.json`（バージョン → `minAppVersion`）を更新 → `release: 0.N.0` でコミット → 注釈付きタグ `git tag -a 0.N.0 -m "フェーズN: <内容>"`

---

## 5. 改行コードと文字コード（Windows 対策）

- `.gitattributes` で改行を LF に統一する（Windows と GitHub の差分に改行の違いが混ざるのを防ぐ）
  ```
  * text=auto eol=lf
  *.png  binary
  *.jpg  binary
  *.docx binary
  *.xlsx binary
  ```
- 日本語のファイル名を `git status` でそのまま表示する: `git config core.quotepath false`
- テキストはすべて UTF-8（BOM なし）

---

## 6. リモート（GitHub）

- 公開までは非公開（private）リポジトリで管理してよい。フェーズ6 の前に公開に切り替える
- push する前に、`.gitignore` の対象（`data.json`、変換結果）が入っていないことを `git status` で確認する

---

## 7. Claude Code によるコミットの自動化

- `.claude/settings.json` の Stop hook（`.claude/hooks/require-commit.sh`）が、Claude の応答が終わるときに `git status` を確認する
- 未コミットの変更があれば、Claude に「本ルールの書式でコミットしてから終える」よう指示する。コミットメッセージは Claude が差分を読んで書く
- 変更が複数の論理的なまとまりに分かれる場合、Claude はコミットを分ける
- Obsidian で手作業で編集した未コミットの変更も、次に Claude が応答を終えるときに同じ扱いでコミットされる
- push は自動では行わない
- 一時的に止めたいとき: `.claude/settings.json` の `"Stop"` の項目を削除する（または Claude に頼む）
