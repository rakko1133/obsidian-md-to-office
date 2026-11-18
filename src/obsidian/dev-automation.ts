// 開発用の自動実行（開発ビルドだけ: main.ts で __DEV__ のときだけ呼ぶ）。
// Claude Code などが画面を操作せずに Obsidian での動作を確かめられるようにする。
// - 自動の読み込み直し: プラグインのフォルダの main.js が変わったら、プラグインを無効 → 有効にする
// - ファイルによる実行の依頼: dev-request.json を見つけたら、確認画面と結果画面を出さずに変換し、dev-result.json に結果を書く
// - 状態: 読み込んだときに dev-status.json を書く（どのビルドが動いているかを外から確かめる）
// 使い方は scripts/obsidian-run.mjs と docs/process/development.md。
import { TFolder, type TAbstractFile } from "obsidian";
import type { PluginSettings } from "../core/settings";
import type BatchOfficeExportPlugin from "../main";
import { runExport, type ExportMode } from "./export-runner";

const POLL_MS = 1000;
const REQUEST_FILE = "dev-request.json";
const RESULT_FILE = "dev-result.json";
const STATUS_FILE = "dev-status.json";

interface DevRequest {
	id: string;
	mode: ExportMode;
	/** Vault からの相対パス（ファイルかフォルダ）。空文字は Vault 全体 */
	paths: string[];
	/** この実行だけに使う設定の上書き */
	settings?: Partial<PluginSettings>;
	/** 1 フォルダを 1 つの .docx にまとめる（C-8） */
	combine?: boolean;
}

export function registerDevAutomation(plugin: BatchOfficeExportPlugin, pluginDir: string): void {
	const adapter = plugin.app.vault.adapter;
	const file = (name: string) => `${pluginDir}/${name}`;
	let buildMtime = 0;
	let busy = false;

	const start = async () => {
		buildMtime = (await adapter.stat(file("main.js")))?.mtime ?? 0;
		await adapter.write(file(STATUS_FILE), JSON.stringify({ loadedAt: new Date().toISOString(), buildMtime, version: plugin.manifest.version }, null, "\t"));
	};
	void start();

	plugin.registerInterval(
		window.setInterval(() => {
			if (busy) return;
			busy = true;
			void tick().finally(() => (busy = false));
		}, POLL_MS),
	);

	async function tick(): Promise<void> {
		// 新しいビルドが配置されたら読み込み直す（書き込みの途中を避けるため、少し待ってから）
		const mtime = (await adapter.stat(file("main.js")))?.mtime ?? 0;
		if (buildMtime !== 0 && mtime !== buildMtime) {
			const id = plugin.manifest.id;
			const plugins = (plugin.app as unknown as { plugins: { disablePlugin(id: string): Promise<void>; enablePlugin(id: string): Promise<void> } }).plugins;
			// 自分を無効にすると、このプラグインの interval は止まる。window の setTimeout は残るので、そこで有効に戻す
			window.setTimeout(async () => {
				await plugins.disablePlugin(id);
				await plugins.enablePlugin(id);
			}, 500);
			buildMtime = 0;
			return;
		}
		if (!(await adapter.exists(file(REQUEST_FILE)))) return;
		let request: DevRequest;
		try {
			request = JSON.parse(await adapter.read(file(REQUEST_FILE))) as DevRequest;
		} finally {
			await adapter.remove(file(REQUEST_FILE)).catch(() => undefined);
		}
		const result = await run(request).catch((error: unknown) => ({ error: error instanceof Error ? error.stack ?? error.message : String(error) }));
		await adapter.write(file(RESULT_FILE), JSON.stringify({ id: request.id, finishedAt: new Date().toISOString(), ...result }, null, "\t"));
	}

	async function run(request: DevRequest): Promise<Record<string, unknown>> {
		const vault = plugin.app.vault;
		const items: TAbstractFile[] = [];
		const missing: string[] = [];
		for (const path of request.paths) {
			const item = path === "" || path === "/" ? vault.getRoot() : vault.getAbstractFileByPath(path);
			if (item) items.push(item);
			else missing.push(path);
		}
		if (missing.length > 0) return { error: `not found: ${missing.join(", ")}` };
		const source = items.length === 1 && items[0] instanceof TFolder && items[0].isRoot() ? ({ kind: "vault" } as const) : ({ kind: "items", items } as const);
		const report = await runExport(
			{ app: plugin.app, settings: plugin.settings, pluginDir },
			request.mode,
			source,
			{ ...(request.settings ? { settings: request.settings } : {}), ...(request.combine ? { combine: true } : {}) },
		);
		if (!report) return { error: "not run (already running, no targets, or cancelled)" };
		return {
			end: report.end,
			runWarnings: report.runWarnings,
			results: report.results.map((r) => ({
				notePath: r.notePath,
				status: r.status,
				...(r.reason ? { reason: r.reason } : {}),
				files: r.files.map((f) => ({ path: `${f.output.location}:${f.output.path}`, status: f.status, ...(f.reason ? { reason: f.reason } : {}) })),
				warnings: r.warnings,
			})),
		};
	}
}
