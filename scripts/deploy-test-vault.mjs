// ビルド結果をテスト用 Vault のプラグインフォルダにコピーする（フェーズ 0 の完了条件 B1）。
// 先に `npm run build:dev`（開発用コマンドあり）か `npm run build`（本番）で main.js を作っておく。
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ID = "batch-office-export";
const target = join("test-vault", ".obsidian", "plugins", PLUGIN_ID);
const files = ["main.js", "manifest.json", "styles.css"];

if (!existsSync("main.js")) {
	console.error("main.js がありません。先に npm run build:dev か npm run build を実行してください。");
	process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of files) {
	if (!existsSync(file)) continue;
	copyFileSync(file, join(target, file));
	console.log(`copied ${file} -> ${target}`);
}
