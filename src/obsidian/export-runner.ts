// 書き出しの全体の流れ（01→02→03→（04・06・07）→09→10）。モードごとに、ドライランとノート 1 件の処理だけを差し替える。
// - mermaid: Mermaid 画像として保存（R1 の単独保存・フェーズ 1）
// - docx: Word に変換（フェーズ 2。フェーズ 3a でリンク・埋め込み・画像などを足した）
import { FileSystemAdapter, Notice, TFile, type App } from "obsidian";
import * as nodePath from "path";
import { exportDocxNote, planDocxNote, type PlannedOutput, type VaultEnvironment } from "../core/docx-export";
import { applyResults } from "../core/manifest";
import { exportMermaidNote, planMermaidNote, type MermaidExportDeps } from "../core/mermaid-export";
import { runSequential } from "../core/run";
import type { PluginSettings } from "../core/settings";
import { filterTargets } from "../core/targets";
import type { ManifestSnapshot, NoteResult, OutputRef, Warning } from "../core/types";
import { t } from "../i18n";
import { collectCandidates, type TargetSource } from "./collect";
import { confirmTargets } from "./confirm-modal";
import { FsDiagramCache } from "./diagram-cache";
import { FsOutputWriter, type OutputRoots } from "./fs-writer";
import { ManifestStore } from "./manifest-store";
import { createMermaidRenderer } from "./mermaid-renderer";
import { createVaultEnvironment } from "./vault-env";
import { ProgressNotice } from "./progress";
import { showReport } from "./report-modal";

export type ExportMode = "mermaid" | "docx";

export interface ExportHost {
	app: App;
	settings: PluginSettings;
	/** プラグインのフォルダ（Vault からの相対パス。例: .obsidian/plugins/batch-office-export） */
	pluginDir: string;
}

interface ModeContext {
	settings: PluginSettings;
	deps: MermaidExportDeps;
	app: App;
	/** リンクの解決・画像・色付け・frontmatter（フェーズ 3a） */
	vault: VaultEnvironment;
	/** 今回の実行の対象（確認画面で選んだノート）。内部リンクの変換対象の範囲（A-18） */
	selected: ReadonlySet<string>;
}

/** モードごとの違い: 確認画面の題名、ドライラン、ノート 1 件の処理。 */
interface ModeDefinition {
	title: () => string;
	plan(ctx: ModeContext, notePath: string): Promise<PlannedOutput[]>;
	process(ctx: ModeContext, notePath: string, signal: AbortSignal, manifest: ManifestSnapshot): Promise<NoteResult>;
}

const MODES: Record<ExportMode, ModeDefinition> = {
	mermaid: {
		title: () => t("confirm.title"),
		plan: async ({ settings, deps }, path) => planMermaidNote(path, await deps.readNote(path), settings, deps.renderer.version, (ref) => deps.writer.exists(ref)),
		process: ({ settings, deps }, path, signal, manifest) => exportMermaidNote(path, signal, settings, manifest, deps),
	},
	docx: {
		title: () => t("confirm.titleWord"),
		plan: async ({ settings, deps }, path) => {
			const exists = (ref: OutputRef) => deps.writer.exists(ref);
			const plans = await planDocxNote(path, settings, exists);
			if (settings.saveImageFiles) plans.push(...(await planMermaidNote(path, await deps.readNote(path), settings, deps.renderer.version, exists)));
			return plans;
		},
		process: ({ settings, deps, app, vault, selected }, path, signal, manifest) =>
			exportDocxNote(path, signal, settings, manifest, { ...deps, strictLineBreaks: readStrictLineBreaks(app), vault, convertedNotes: selected }),
	},
};

/** Obsidian の「厳密な改行」の設定（A-2）。非公開 API なので、読めなければ undefined。 */
function readStrictLineBreaks(app: App): boolean | undefined {
	const vault = app.vault as unknown as { getConfig?: (key: string) => unknown };
	try {
		const value = vault.getConfig?.("strictLineBreaks");
		return typeof value === "boolean" ? value : undefined;
	} catch {
		return undefined;
	}
}

let running = false;

export async function runExport(host: ExportHost, mode: ExportMode, source: TargetSource): Promise<void> {
	if (running) {
		new Notice(t("notice.alreadyRunning"));
		return;
	}
	const { app } = host;
	const definition = MODES[mode];
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
		const ctx: ModeContext = { settings, app, deps: { readNote, renderer, cache, writer }, vault: await createVaultEnvironment(app), selected: new Set() };

		// 02: 実行前の確認画面（ドライラン）
		const outputLabel =
			settings.saveMode === "sameFolder"
				? t("settings.saveMode.sameFolder")
				: settings.outputLocation === "external"
					? settings.externalOutputRoot
					: `${settings.outputRoot}/`;
		const selected = await confirmTargets(app, {
			title: definition.title(),
			targets,
			excludedCount: excluded.length,
			outputLabel,
			plan: (path) => definition.plan(ctx, path),
		});
		if (!selected || selected.length === 0) return;
		ctx.selected = new Set(selected);

		// 10: マニフェストは開始時に 1 回だけ読む（D4）
		const { snapshot, warnings: loadWarnings } = await store.load();
		const runWarnings: Warning[] = [...loadWarnings];

		// 03: 1 件ずつ順に変換
		const progress = new ProgressNotice();
		let outcome;
		try {
			outcome = await runSequential({
				notes: selected,
				processNote: (path, signal) => definition.process(ctx, path, signal, snapshot),
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
