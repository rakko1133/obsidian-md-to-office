# 開発の手順

最終更新: 2026-11-18

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
