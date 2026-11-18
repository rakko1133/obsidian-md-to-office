# テスト用 Vault

Batch Office Export の動作確認に使う Vault（G5）。Obsidian で「保管庫としてフォルダを開く」からこのフォルダを開く。

- `mermaid/`: Mermaid の図種ごとのサンプル（1 図 = 1 ノート）。R1・R4 の確認に使う
- `word/`: Word に変換する記法のサンプル（フェーズ 2）
- `word3a/`: フェーズ 3a のサンプル（内部リンク・埋め込み・画像・コールアウト・コードの色付け・脚注・コメント・frontmatter・HTML・添付ファイル）。`parts/` は埋め込み用のノート、`attachments/` は画像・PDF・音声。画像などは `scripts/make-word3a-assets.py`（Pillow が必要）で作った単純な図形
- ほかの記法のサンプルは、その記法を扱うフェーズの最初に足す

プラグインの配置の手順は `docs/process/development.md` を参照。
