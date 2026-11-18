// 開いている Obsidian（テスト用 Vault・開発用ビルド）に変換を頼み、結果を表示する（src/obsidian/dev-automation.ts と対で使う）。
// 画面を操作しないので、Obsidian は後ろや最小化の状態でよい。
//
//   node scripts/obsidian-run.mjs --mode xlsx --path excel
//   node scripts/obsidian-run.mjs --mode docx --path word3a --path word3b --set downloadExternalImages=true
//   node scripts/obsidian-run.mjs --wait-reload        # 配置した main.js を Obsidian が読み込み直すまで待つだけ
//
// オプション: --mode mermaid|docx|xlsx（既定 docx）、--path（複数可。空文字で Vault 全体）、--set キー=値（複数可。この実行だけの設定。
// 値は JSON として読めればその値、読めなければ文字列）、--timeout 秒（既定 300）、--json（結果をそのまま出す）
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const PLUGIN_DIR = join("test-vault", ".obsidian", "plugins", "batch-office-export");
const REQUEST = join(PLUGIN_DIR, "dev-request.json");
const RESULT = join(PLUGIN_DIR, "dev-result.json");
const STATUS = join(PLUGIN_DIR, "dev-status.json");

const args = process.argv.slice(2);
const opts = { mode: "docx", paths: [], settings: {}, timeout: 300, json: false, waitReload: false };
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--mode") opts.mode = args[++i];
	else if (a === "--path") opts.paths.push(args[++i] ?? "");
	else if (a === "--set") {
		const [key, ...rest] = (args[++i] ?? "").split("=");
		const raw = rest.join("=");
		try {
			opts.settings[key] = JSON.parse(raw);
		} catch {
			opts.settings[key] = raw;
		}
	} else if (a === "--timeout") opts.timeout = Number(args[++i]);
	else if (a === "--json") opts.json = true;
	else if (a === "--wait-reload") opts.waitReload = true;
	else {
		console.error(`unknown option: ${a}`);
		process.exit(2);
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + opts.timeout * 1000;

/** 配置した main.js を Obsidian が読み込み直すまで待つ（dev-status.json の buildMtime が main.js の更新日時と一致するまで）。 */
async function waitReload() {
	const mtime = Math.floor(statSync(join(PLUGIN_DIR, "main.js")).mtimeMs);
	while (Date.now() < deadline) {
		if (existsSync(STATUS)) {
			try {
				const status = JSON.parse(readFileSync(STATUS, "utf8"));
				if (Math.abs(status.buildMtime - mtime) < 1000) return status;
			} catch {
				// 書き込みの途中
			}
		}
		await sleep(500);
	}
	throw new Error("Obsidian did not reload the plugin. Is the test vault open with the development build (npm run build:dev)?");
}

const status = await waitReload();
if (opts.waitReload) {
	console.log(`reloaded: ${status.loadedAt} (version ${status.version})`);
	process.exit(0);
}
if (opts.paths.length === 0) {
	console.error("--path is required (use --path \"\" for the whole vault)");
	process.exit(2);
}

const id = randomUUID();
if (existsSync(RESULT)) unlinkSync(RESULT);
writeFileSync(REQUEST, JSON.stringify({ id, mode: opts.mode, paths: opts.paths, settings: opts.settings }, null, "\t"));

let result = null;
while (Date.now() < deadline) {
	if (existsSync(RESULT)) {
		try {
			const r = JSON.parse(readFileSync(RESULT, "utf8"));
			if (r.id === id) {
				result = r;
				break;
			}
		} catch {
			// 書き込みの途中
		}
	}
	await sleep(500);
}
if (!result) {
	console.error("timed out waiting for Obsidian (is the test vault open with the development build?)");
	process.exit(1);
}
if (opts.json) {
	console.log(JSON.stringify(result, null, 2));
} else if (result.error) {
	console.error(`error: ${result.error}`);
} else {
	const count = (s) => result.results.filter((r) => r.status === s).length;
	console.log(`end: ${result.end} / success ${count("success")}, skipped ${count("skipped")}, failed ${count("failed")}`);
	const files = new Map();
	for (const r of result.results) for (const f of r.files) files.set(f.path, f.status);
	for (const [path, s] of files) console.log(`  ${s.padEnd(9)} ${path}`);
	for (const r of result.results) {
		if (r.status !== "success") console.log(`  ${r.status}: ${r.notePath}${r.reason ? ` (${r.reason})` : ""}`);
		for (const w of r.warnings) console.log(`  warning: ${r.notePath}: ${w.code}${w.detail ? ` ${w.detail}` : ""}`);
	}
	for (const w of result.runWarnings) console.log(`  run warning: ${w.code}${w.detail ? ` ${w.detail}` : ""}`);
}
process.exit(result.error || result.results.some((r) => r.status === "failed") ? 1 : 0);
