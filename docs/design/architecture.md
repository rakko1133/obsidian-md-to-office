# コンポーネント構成

最終更新: 2026-11-17
段階: 要件単位の全体図（試作）。要件の正本は `docs/requirements.md`

## 全体図（要件単位）

- 1 ノード = 1 コンポーネント。名前は「何をするか」を表し、括弧内に対応する要件 ID を書く
- 実線の矢印 = データの流れ（ラベルは受け渡すもの）
- 点線の矢印 = 制御の合図、または実行の文脈として渡す読み取り専用のデータ
- 円柱 = ファイルとして保存するデータ
- R3（安全な運用）は性質の違う機能の総称なので、「1 件ずつ順に変換」「ファイルの書き込み」「実行結果の記録」の 3 つに分けている。R3 のドライランは「実行前の確認画面」に含める
- 「1 件ずつ順に変換」が全体を取りまとめる。構文解析の結果（mdast）はいったんここに戻り、出力単位と、どのグループ（ブック / 結合 .docx）に入るかを添えて .docx・.xlsx の生成に渡す（2026-11-17 決定）
  - 出力単位は形式ごとに持つ（2026-11-18 決定）。Word: 1 ノート = 1 .docx / 結合出力。Excel: 単一ノート / 1 フォルダ = 1 ブック / 1 ノート = 1 ブック
  - グループの全ノートを処理し終えたら、各ノートの成否に関係なく、.docx・.xlsx の生成に「グループの完成の指示」を別に出す（2026-11-18 決定）。最後のノートが失敗しても、ブックや結合 .docx は完成する
- タイムアウト時の `AbortSignal` は、図では「Markdown の構文解析と変換」への 1 本だけを描いている。実際には、ノートごとの文脈として描画・生成・書き込みのすべての処理に渡す（中断ボタンでは abort しない。R3）

```mermaid
flowchart LR
  Collect["変換対象の収集<br/>単一ノート / 複数選択 / フォルダ（再帰）/ Vault 全体<br/>→ glob と export:false で除外<br/>(R2)"]
  Confirm["実行前の確認画面<br/>対象一覧・出力先・上書き予定を表示<br/>(R2, R3)"]
  Run["1 件ずつ順に変換<br/>進捗表示・中断・タイムアウト<br/>(R3)"]
  Pipe["Markdown の構文解析と変換<br/>.md → mdast・Obsidian 記法の解釈<br/>(G2, R5)"]
  Ext["Obsidian に描画を依頼<br/>Dataview・数式・他プラグイン<br/>(R5 A-0a)"]
  Mmd["Mermaid の画像化<br/>SVG / PNG 生成・キャッシュ<br/>(R1, R4)"]
  Docx[".docx の生成<br/>(R6)"]
  Xlsx[".xlsx の生成<br/>(R7)"]
  Write["ファイルの書き込み<br/>出力パス決定・同名の扱い<br/>一時ファイル → rename<br/>(R8, R3)"]
  Log["実行結果の記録<br/>結果レポート・マニフェストの読み書き<br/>(R3)"]
  Manifest[("export-record.json<br/>(R3)")]

  Collect -->|対象ノート一覧| Confirm
  Confirm -->|実行指示| Run
  Manifest -->|開始時に 1 回読む| Run
  Run -->|ノート 1 件| Pipe
  Pipe -->|描画依頼| Ext
  Ext -->|描画結果| Pipe
  Pipe -->|Mermaid ソース| Mmd
  Pipe -->|mdast| Run
  Run -->|mdast + Word の出力単位| Docx
  Run -->|mdast + Excel の出力単位| Xlsx
  Run -->|グループの完成の指示| Docx
  Run -->|グループの完成の指示| Xlsx
  Mmd -->|SVG / PNG| Docx
  Mmd -->|PNG| Xlsx
  Mmd -->|画像ファイル| Write
  Docx -->|.docx| Write
  Xlsx -->|.xlsx| Write
  Write -->|出力ファイルごとの結果| Run
  Run -->|ノートごとの結果| Log
  Log -->|最後に 1 回保存| Manifest
  Run -.->|マニフェストの写し| Pipe
  Run -.->|マニフェストの写し| Mmd
  Run -.->|AbortSignal（タイムアウト時）| Pipe
```

## コンポーネントごとの処理フロー

各コンポーネントの内部の処理フローは、次のファイルに分けている。各ファイルの末尾に、まだ決まっていない点（「決める必要があること」）がある。

| コンポーネント | フロー図 |
|---|---|
| 変換対象の収集 | [01-collect-targets.md](flows/01-collect-targets.md) |
| 実行前の確認画面 | [02-confirm-modal.md](flows/02-confirm-modal.md) |
| 1 件ずつ順に変換 | [03-run-sequential.md](flows/03-run-sequential.md) |
| Markdown の構文解析と変換 | [04-parse-transform.md](flows/04-parse-transform.md) |
| Obsidian に描画を依頼 | [05-obsidian-render.md](flows/05-obsidian-render.md) |
| Mermaid の画像化 | [06-mermaid-image.md](flows/06-mermaid-image.md) |
| .docx の生成 | [07-docx-render.md](flows/07-docx-render.md) |
| .xlsx の生成 | [08-xlsx-render.md](flows/08-xlsx-render.md) |
| ファイルの書き込み | [09-write-file.md](flows/09-write-file.md) |
| 実行結果の記録 | [10-record-results.md](flows/10-record-results.md) |

## この粒度で表していないもの

- Obsidian API に依存する部分と依存しない部分（G2・G4）の境界。1 つのコンポーネントの中に両方が混ざるため
- 「1 件ずつ順に変換」の中の制御（キャンセル・タイムアウト）と、「ファイルの書き込み」の中のアトミック書き込みの手順
- 必要になったら、該当するコンポーネントだけ詳細図を別に作る
