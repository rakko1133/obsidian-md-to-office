# Mermaid: flowchart（日本語ラベル）

図の種類: `flowchart LR`

```mermaid
flowchart LR
    収集["変換対象の収集"] --> 確認{"実行してよいか"}
    確認 -->|はい| 変換["1 件ずつ順に変換"]
    確認 -->|いいえ| 終了(["何もしない"])
```
