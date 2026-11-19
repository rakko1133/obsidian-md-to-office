# 処理時間のフロー（計測結果）

最終更新: 2026-11-19
段階: 高速化の検討のための現状の計測。計測の手順は `docs/process/development.md` の「処理時間の計測」、経緯は `docs/process/worklog.md`

## 計測の条件

- ビルド: 開発用ビルド（1.1.1 の後、`feat/profiling`）。`npm run obsidian:run -- --profile` で計測した
- Obsidian: テスト用 Vault を開き、ウィンドウは後ろに置いた状態（前面ではない）
- 対象

| 実行 | 対象のフォルダ | ノート数 | 備考 |
|---|---|---|---|
| Word（キャッシュなし） | `word3a`・`word3b`・`mermaid`・`style` | 47 | Mermaid のキャッシュを消してから実行。Mermaid 図 26 個 |
| Word（キャッシュあり） | 同上 | 47 | 直前の実行のキャッシュが残っている |
| Excel | `excel`・`word3a` | 24 | 1 フォルダ = 1 ブック。表のある 9 件がシートになり、15 件はスキップ |
| PDF | `word3a`・`mermaid` | 38 | 1 ノート = 1 PDF |

## 図の読み方

- 1 ノード = 1 つの処理。ノードの数値は**実行全体での合計時間**（包含時間: 子の処理の時間を含む）と呼び出し回数。単位は ms、s
- 実線の矢印 = 処理の順序。点線の矢印 = 子の処理への分解（親の時間に含まれる）
- 赤 = 全体の 20% 以上を占める処理、橙 = 5〜20%、色なし = 5% 未満
- 合計が親と一致しないのは、計測点を置いていない処理（分岐・データの組み替えなど）の時間があるため

## 1. 実行全体（Word・キャッシュあり: 14.4 s）

```mermaid
flowchart TD
  Collect["01 変換対象の収集<br/>0.4 ms"]
  Prepare["準備<br/>Mermaid の読み込み 0.0 ms・Vault 環境 0.0 ms<br/>マニフェストの読み込み 0.8 ms"]
  Notes["03 ノート 1 件ずつの変換 × 47<br/>14.4 s（100%）"]
  Finish["グループの完成<br/>0.0 ms"]
  Save["10 マニフェストの保存 2.6 ms<br/>キャッシュの整理 2.9 ms"]

  Collect --> Prepare --> Notes --> Finish --> Save

  Notes -.-> P["ノートの組み立て + 図の準備（docx/prepare）<br/>13.7 s（95%）"]
  Notes -.-> R[".docx の生成（docx/render）<br/>436 ms（3.0%）"]
  Notes -.-> W["書き込み（docx/write）<br/>269 ms（1.9%）"]

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  classDef warm fill:#fde2c4,stroke:#d35400,color:#000
  class Notes,P hot
```

確認画面（02）は自動実行では出さないので、計測に含まない。

## 2. ノート 1 件の変換（Word）

| 処理 | キャッシュなし | キャッシュあり |
|---|---:|---:|
| ノート 1 件の変換（合計） | 41.3 s | 14.4 s |
| ノートの組み立て（`assembleNote`） | 13.7 s | 13.7 s |
| Mermaid 図の準備 × 26 | **26.6 s** | 41 ms |
| .docx の生成 | 508 ms | 436 ms |
| 書き込み | 501 ms | 269 ms |

```mermaid
flowchart TD
  Assemble["ノートの組み立て（assembleNote）<br/>13.7 s（95%）"]
  Diagram["Mermaid 図の準備 × 26<br/>なし 26.6 s ／ あり 41 ms"]
  Render[".docx の生成（renderDocx）<br/>436 ms"]
  Write["書き込み（同名の判定・一時ファイル → rename）<br/>269 ms"]

  Assemble --> Diagram --> Render --> Write

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  class Assemble,Diagram hot
```

## 3. ノートの組み立て（13.7 s）

Word と Excel で共通（`src/core/note-assembly.ts`）。

```mermaid
flowchart TD
  Load["読み込みと構文解析（loadNote）<br/>47 ms<br/>うち構文解析 53 ms × 61（埋め込み先を含む）"]
  Embeds["埋め込みの展開<br/>13 ms"]
  Plugin["他プラグインの描画（Dataview など）<br/>6.5 s（45%）"]
  Links["Mermaid の連番・リンクの解決<br/>1.6 ms"]
  Assets["画像・数式・コードの色付けの準備<br/>7.1 s（49%）"]

  Load --> Embeds --> Plugin --> Links --> Assets

  Plugin -.-> PR["Obsidian の描画（MarkdownRenderer.render）× 7<br/>7.3 ms"]
  Plugin -.-> PQ["描画の静止待ち（waitForQuiet）× 7<br/>4.5 s（31%）"]
  Plugin -.-> PD["DOM → mdast × 7<br/>2.0 s<br/>うち図の画像化 × 2 = 2.0 s"]

  Assets -.-> AI["画像の読み込みと変換 × 14<br/>5.1 s（35%）<br/>読み込み 6 ms・変換 5.1 s"]
  Assets -.-> AM["数式の画像 × 3<br/>2.0 s（14%）<br/>MathJax 7 ms・PNG 化 2.0 s"]
  Assets -.-> AH["コードの色付け（Prism）<br/>0.6 ms"]

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  classDef warm fill:#fde2c4,stroke:#d35400,color:#000
  class Plugin,Assets,PQ,AI hot
  class PD,AM warm
```

## 4. 画像を PNG にする処理（各所の共通の部品）

SVG の画像の PNG の代替・WebP などの変換（`vault-env.ts` の `loadImage`）、数式の画像、他プラグインの図の画像化、Mermaid 図の PNG 化（`mermaid-renderer.ts` の `svgToPng`）は、どれも同じ手順で PNG を作る。

```mermaid
flowchart TD
  Decode["画像のデコード（HTMLImageElement.decode）<br/>loadImage: 20 ms × 17 ／ Mermaid: 1.2 ms × 26"]
  Draw["canvas への描画（drawImage）<br/>0.9 ms × 8"]
  Blob["PNG への符号化（canvas.toBlob）<br/>loadImage: 8.1 s × 8（1 回 1.01 s）<br/>Mermaid: 26.3 s × 26（1 回 1.01 s）"]
  Bytes["バイト列に変換（Blob.arrayBuffer）"]

  Decode --> Draw --> Blob --> Bytes

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  class Blob hot
```

- `toBlob` は呼び出しごとに 1.01 s 前後でほぼ一定。画像の大きさに関係しない。キャッシュなしの Word では、`toBlob` が全体の **83%**（34.4 s / 41.3 s）、キャッシュありでも **56%**（8.1 s / 14.4 s）を占める
- デコードと描画は合わせて数十 ms なので、時間の大半は PNG の符号化そのものではなく、`toBlob` が符号化を始めるまでの待ちと考えられる（Chromium は `toBlob` の符号化をアイドル時間に回す。ウィンドウが後ろにあるとアイドル時間が来ず、一定時間後に始めるという仮説。前面での計測で確かめる）

## 5. Mermaid 図の準備（1 図あたり）

```mermaid
flowchart TD
  Hash["キャッシュのキー（SHA-256）<br/>0.04 ms"]
  Cache{"キャッシュにあるか<br/>読み込み 0.8 ms"}
  Mmd["mermaid.render（SVG の生成）<br/>2.0 ms"]
  Png["PNG 化（4 の処理）<br/>1,013 ms"]
  Put["キャッシュに保存"]
  Done["SVG + PNG"]

  Hash --> Cache
  Cache -- ある --> Done
  Cache -- ない --> Mmd --> Png --> Put --> Done

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  class Png hot
```

## 6. .docx の生成（436 ms・47 件）

```mermaid
flowchart TD
  Blocks["mdast → docx の段落・表（Renderer.blocks）<br/>88 ms"]
  Doc["Document の組み立て（スタイル・番号・ページ設定）"]
  Pack["XML の生成と ZIP 圧縮（Packer.pack）<br/>310 ms"]
  Fix["見出し番号の開始番号の上書きを除く<br/>見出し番号の設定のときだけ"]

  Blocks --> Doc --> Pack --> Fix
```

## 7. Excel（5.4 s・24 件）

```mermaid
flowchart TD
  Assemble["ノートの組み立て × 24<br/>5.2 s（97%）<br/>うち画像の変換 5.1 s（toBlob × 5 = 5.1 s）"]
  Sheet["表をシートに足す × 9<br/>4.1 ms"]
  Book["ブックの完成（exceljs の書き出し）× 5<br/>47 ms"]
  Write["書き込み × 5<br/>85 ms"]

  Assemble --> Sheet --> Book --> Write

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  class Assemble hot
```

- 表のないノート（15 件はシートにならずスキップ）の画像も、組み立ての段階で読み込んで PNG にしている

## 8. PDF（27.6 s・38 件）

```mermaid
flowchart TD
  Render["Obsidian の描画（MarkdownRenderer.render）× 38<br/>648 ms"]
  Quiet["描画の静止待ち（waitForQuiet）× 38<br/>19.3 s（70%）<br/>1 回 508 ms"]
  Links["見出しの id・リンクの書き換え・目次"]
  Print["印刷（webContents.printToPDF）× 38<br/>6.9 s（25%）"]
  Post["後処理（pdf-lib: しおり・文書情報）× 38<br/>603 ms"]
  Write["書き込み × 38<br/>168 ms"]

  Render --> Quiet --> Links --> Print --> Post --> Write

  classDef hot fill:#f8d7da,stroke:#c0392b,color:#000
  class Quiet,Print hot
```

- 静止待ちは、DOM の変化が `QUIET_MS`（500 ms）続けて止まるまで待つ。変化しないノートでも 500 ms かかるので、1 回 508 ms がほぼ下限どおり

## まとめ: 時間の大きい処理

| 順位 | 処理 | 影響する形式 | 時間（この計測） | 性質 |
|---|---|---|---|---|
| 1 | `canvas.toBlob`（PNG への符号化の待ち） | Word・Excel | Word キャッシュなし 34.4 s（83%）、あり 8.1 s（56%）、Excel 5.1 s（94%） | 1 回 1.01 s の待ち。計算ではない |
| 2 | 描画の静止待ち `waitForQuiet` | PDF・Word（他プラグイン） | PDF 19.3 s（70%）、Word 4.5 s（31%） | 1 回 500 ms 以上の固定の待ち |
| 3 | `printToPDF` | PDF | 6.9 s（25%） | Chromium の印刷。この仕組みでは減らしにくい |
| — | 構文解析・.docx の生成・ZIP 圧縮・ファイルの読み書き | すべて | 合わせて 1 s 未満 | CPU の処理。改善の余地は小さい |
