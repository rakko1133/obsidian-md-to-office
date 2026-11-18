# 文書の案内

Obsidian の .md を .docx / .xlsx に一括変換するプラグイン（ID: `batch-office-export`）の設計文書。

## 構成

```
docs/
├── README.md                  この案内
├── requirements.md            要件の正本（R1〜R8・G1〜G5・H・ロードマップ・未決事項）
├── design/                    設計
│   ├── architecture.md        全体のコンポーネント図
│   ├── flows/                 コンポーネントごとの処理フロー図（01〜10）
│   ├── settings.md            設定項目の一覧（キー・既定値・要件・実装フェーズ）
│   └── dependencies.md        依存ライブラリとライセンス
└── process/                   進め方のルール
    ├── development.md         ビルド・テスト・テスト用 Vault での確認の手順
    ├── git-rules.md           ブランチ・コミット・バージョンの規則
    ├── worklog.md             作業記録（いつ・何をしたか。新しいものが上）
    └── prompts/
        └── component-flows.md フロー図を作るときに使ったプロンプト集
```

## 読む順番

1. [requirements.md](requirements.md): 何を作るか。要件はここが正本で、ほかの文書と食い違ったらこちらを優先する
2. [design/architecture.md](design/architecture.md): どのコンポーネントで作るか。各フロー図へのリンクもここにある
3. [design/flows/](design/flows/): 各コンポーネントの中の処理。各ファイルの末尾に、まだ決まっていない点（「決める必要があること」）と決定済みの点がある
4. [process/development.md](process/development.md): ビルド・テストの実行と、テスト用 Vault での確認の手順
5. [process/git-rules.md](process/git-rules.md): 変更をコミットするときの規則
6. [process/worklog.md](process/worklog.md): これまでの作業の経緯

## 文書を足すときの置き場所

- 要件を変える・足す: `requirements.md`（変更はそれだけでコミットする。git-rules.md の 3 章）
- 設計の図や仕様: `design/` の下
- 作業の進め方・ルール・プロンプト: `process/` の下
