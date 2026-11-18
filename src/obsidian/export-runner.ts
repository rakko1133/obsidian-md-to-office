// 「Mermaid 画像として保存」の全体の流れ（R1 の単独保存: 01→02→03→06→09→10）。
import { FileSystemAdapter, Notice, TFile, type App } from "obsidian";
import * as nodePath from "path";
import { applyResults } from "../core/manifest";
import { exportMermaidNote, planMermaidNote, type MermaidExportDeps } from "../core/mermaid-export";
import { runSequential } from "../core/run";
import type { PluginSettings } from "../core/settings";
import { filterTargets } from "../core/targets";
import type { Warning } from "../core/types";
import { t } from "../i18n";
import { collectCandidates, type TargetSource } from "./collect";
import { confirmTargets } from "./confirm-modal";
import { FsDiagramCache } from "./diagram-cache";
import { FsOutputWriter, type OutputRoots } from "./fs-writer";
import { ManifestStore } from "./manifest-store";
import { createMermaidRenderer } from "./mermaid-renderer";
import { ProgressNotice } from "./progress";
import { showReport } from "./report-modal";

export interface ExportHost {
	app: App;
	settings: PluginSettings;
	/** プラグインのフォルダ（Vault からの相対パス。例: .obsidian/plugins/batch-office-export） */
	pluginDir: string;
}

let running = false;

export async function saveMermaidImages(host: ExportHost, source: TargetSource): Promise<void> {
	if (running) {
		new Notice(t("notice.alreadyRunning"));
		return;
	}
	const { app } = host;
	if (source.kind === "active" && !(app.workspace.getActiveFile()?.extension === "md")) {
		new Notice(t("notice.noActiveNote"));
		return;
	}
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return; // isDesktopOnly なので通常は来ない
	// 実行中に設定が変わっても影響しないよう、写しを使う
	const settings: PluginSettings = structuredClone(host.settings);
	if (settings.outputLocation === "external" && settings.saveMode === "mirror" && settings.externalOutputRoot === "") {
		new Notice(t("notice.externalRootMissing"));
		return;
	}

	// 01: 変換対象の収集
	const { targets, excluded } = filterTargets(collectCandidates(app, source), settings.includeGlobs, settings.excludeGlobs);
	if (targets.length === 0) {
		new Notice(t("notice.noTargets", { excluded: String(excluded.length) }));
		return;
	}

	running = true;
	try {
		const basePath = adapter.getBasePath();
		const pluginDirAbs = nodePath.join(basePath, ...host.pluginDir.split("/"));
		const roots: OutputRoots = { vaultBasePath: basePath, externalRoot: settings.externalOutputRoot };
		const writer = new FsOutputWriter(roots, new Set(targets));
		const cache = new FsDiagramCache(nodePath.join(pluginDirAbs, "cache", "mermaid"));
		const store = new ManifestStore(pluginDirAbs);

		let renderer;
		try {
			renderer = await createMermaidRenderer();
		} catch (error) {
			new Notice(t("notice.mermaidUnavailable", { error: String(error) }));
			return;
		}

		const readNote = async (path: string): Promise<string> => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`not found: ${path}`);
			return app.vault.cachedRead(file);
		};

		// 02: 実行前の確認画面（ドライラン）
		const outputLabel =
			settings.saveMode === "sameFolder"
				? t("settings.saveMode.sameFolder")
				: settings.outputLocation === "external"
					? settings.externalOutputRoot
					: `${settings.outputRoot}/`;
		const selected = await confirmTargets(app, {
			targets,
			excludedCount: excluded.length,
			outputLabel,
			plan: async (path) => planMermaidNote(path, await readNote(path), settings, renderer.version, (ref) => writer.exists(ref)),
		});
		if (!selected || selected.length === 0) return;

		// 10: マニフェストは開始時に 1 回だけ読む（D4）
		const { snapshot, warnings: loadWarnings } = await store.load();
		const runWarnings: Warning[] = [...loadWarnings];
		const deps: MermaidExportDeps = { readNote, renderer, cache, writer };

		// 03: 1 件ずつ順に変換
		const progress = new ProgressNotice();
		let outcome;
		try {
			outcome = await runSequential({
				notes: selected,
				processNote: (path, signal) => exportMermaidNote(path, signal, settings, snapshot, deps),
				timeoutMs: settings.timeoutSeconds * 1000,
				onError: settings.onError,
				isCancelled: progress.isCancelled,
				onProgress: (done, total, path) => progress.update(done, total, path),
			});
		} finally {
			progress.hide();
		}

		// 10: 実行の最後に 1 回だけ保存する（中断したときも、書き込んだ分は記録する）
		try {
			await store.save(applyResults(snapshot, outcome.results, new Date().toISOString()));
		} catch (error) {
			runWarnings.push({ code: "manifestSaveFailed", detail: String(error) });
		}
		await cache.evict().catch(() => undefined);

		showReport(app, { end: outcome.end, results: outcome.results, runWarnings });
	} finally {
		running = false;
	}
}
