// 書き出しの全体の流れ（01→02→03→（04・06・07）→09→10）。モードごとに、ドライランとノート 1 件の処理だけを差し替える。
// - mermaid: Mermaid 画像として保存（R1 の単独保存・フェーズ 1）
// - docx: Word に変換（フェーズ 2。フェーズ 3a でリンク・埋め込み・画像などを足した）
// - xlsx: Excel に変換（フェーズ 4a）。1 フォルダ = 1 ブックでは、全ノートの処理の後にブックを完成させる（D7）
// - pdf: PDF に変換（フェーズ 7・H1-PDF）
// 確認画面で複数の形式を選んだときは、形式ごとのモードを順に組み合わせる（definitionFor）
import { FileSystemAdapter, Notice, TFile, getLanguage, normalizePath, type App } from "obsidian";
import { promises as fs } from "fs";
import * as nodePath from "path";
import { exportDocxNote, planDocxNote, type PlannedOutput, type VaultEnvironment } from "../core/docx-export";
import { applyResults } from "../core/manifest";
import { exportMermaidNote, planMermaidNote, type MermaidExportDeps } from "../core/mermaid-export";
import { planPdfNote } from "../core/pdf-export";
import { failedResult, mergeAllResults, runSequential } from "../core/run";
import { DocxCombineRun, planCombinedNote } from "../core/docx-combine";
import { readTemplate, type WordTemplate } from "../core/docx-template";
import { XlsxRun, planXlsxNote, xlsxUnit } from "../core/xlsx-export";
import { SummaryRun, planSummary, type SummaryLabels } from "../core/xlsx-summary";
import type { XlsxLabels } from "../core/xlsx-render";
import type { OutputFormat, PluginSettings } from "../core/settings";
import { filterTargets } from "../core/targets";
import type { ManifestSnapshot, NoteResult, OutputRef, Warning } from "../core/types";
import { t } from "../i18n";
import { collectCandidates, type TargetSource } from "./collect";
import { confirmTargets } from "./confirm-modal";
import { FsDiagramCache } from "./diagram-cache";
import { FsOutputWriter, type OutputRoots } from "./fs-writer";
import { ManifestStore } from "./manifest-store";
import { createMermaidRenderer } from "./mermaid-renderer";
import { PdfRun } from "./pdf-export";
import { useLightTheme } from "./pdf-print";
import { createVaultEnvironment } from "./vault-env";
import { ProgressNotice } from "./progress";
import { showReport } from "./report-modal";

/** office は「確認画面で形式を選ぶ」（初期値は設定 defaultFormats: R8）。both は Word と Excel */
export type ExportMode = "mermaid" | "docx" | "xlsx" | "pdf" | "both" | "summary" | "office";

/** 出力形式 → モード（R8・H1-PDF）。 */
const FORMAT_MODES: Record<OutputFormat, "docx" | "xlsx" | "pdf"> = { word: "docx", excel: "xlsx", pdf: "pdf" };

/** 起動したモードで最初に選ばれている形式。形式を選ばないモード（Mermaid・集計）は undefined。 */
function formatsOfMode(mode: ExportMode, settings: PluginSettings): OutputFormat[] | undefined {
	switch (mode) {
		case "docx":
			return ["word"];
		case "xlsx":
			return ["excel"];
		case "pdf":
			return ["pdf"];
		case "both":
			return ["word", "excel"];
		case "office":
			return [...settings.defaultFormats];
		default:
			return undefined;
	}
}

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
	/** 確認画面に出す候補の件数（ドライランでの Excel の出力単位の判定: R8） */
	targetCount: number;
	/** Excel のブックの状態（確認画面の後に作る） */
	xlsx?: XlsxRun;
	/** Vault 全体の集計の状態（A-34） */
	summary?: SummaryRun;
	/** 1 フォルダを 1 つの .docx にまとめる（C-8。確認画面で選ぶ） */
	combine: boolean;
	/** 結合出力の状態 */
	combined?: DocxCombineRun;
	/** 開始時に読んだマニフェスト（結合出力の変換対象の範囲: A-18） */
	manifest?: ManifestSnapshot;
	/** Word のテンプレート（C-1b。実行の最初に 1 回読む） */
	template?: WordTemplate;
	/** PDF の実行の状態（H1-PDF） */
	pdf?: PdfRun;
}

/** Word の体裁の文字とテンプレート（DocxExportDeps に足す）。 */
function wordExtras(ctx: ModeContext): { tocLabel: string; captionLabels: { figure: string; table: string }; template?: WordTemplate } {
	return { tocLabel: t("docx.toc"), captionLabels: { figure: t("docx.figure"), table: t("docx.table") }, ...(ctx.template ? { template: ctx.template } : {}) };
}

/** モードごとの違い: 確認画面の題名、ドライラン、ノート 1 件の処理。 */
interface ModeDefinition {
	title: () => string;
	plan(ctx: ModeContext, notePath: string): Promise<PlannedOutput[]>;
	process(ctx: ModeContext, notePath: string, signal: AbortSignal, manifest: ManifestSnapshot): Promise<NoteResult>;
	/** 確認画面の後、変換を始める前（Excel のブックの状態を作る） */
	start?(ctx: ModeContext, selected: readonly string[]): void;
	/** 全ノートの処理の後（中断・fail-fast でも呼ぶ。1 フォルダ = 1 ブックを完成させる） */
	finish?(ctx: ModeContext, results: NoteResult[]): Promise<void>;
}

const MODES: Record<Exclude<ExportMode, "office" | "both">, ModeDefinition> = {
	mermaid: {
		title: () => t("confirm.title"),
		plan: async ({ settings, deps }, path) => planMermaidNote(path, await deps.readNote(path), settings, deps.renderer.version, (ref) => deps.writer.exists(ref)),
		process: ({ settings, deps }, path, signal, manifest) => exportMermaidNote(path, signal, settings, manifest, deps),
	},
	docx: {
		title: () => t("confirm.titleWord"),
		plan: async ({ settings, deps, vault, combine }, path) => {
			const exists = (ref: OutputRef) => deps.writer.exists(ref);
			const plans = combine ? await planCombinedNote(path, settings, vault.vaultName, exists) : await planDocxNote(path, settings, exists);
			if (settings.saveImageFiles) plans.push(...(await planMermaidNote(path, await deps.readNote(path), settings, deps.renderer.version, exists)));
			return plans;
		},
		start: (ctx, selected) => {
			if (!ctx.combine) return;
			ctx.combined = new DocxCombineRun(ctx.settings, selected, ctx.manifest ?? { entries: [] }, {
				...ctx.deps,
				strictLineBreaks: readStrictLineBreaks(ctx.app),
				vault: ctx.vault,
				...wordExtras(ctx),
			});
		},
		process: (ctx, path, signal, manifest) =>
			ctx.combined
				? ctx.combined.addNote(path, signal)
				: exportDocxNote(path, signal, ctx.settings, manifest, {
						...ctx.deps,
						strictLineBreaks: readStrictLineBreaks(ctx.app),
						vault: ctx.vault,
						convertedNotes: ctx.selected,
						...wordExtras(ctx),
					}),
		finish: async ({ combined }, results) => {
			await combined?.finish(results);
		},
	},
	xlsx: {
		title: () => t("confirm.titleExcel"),
		plan: ({ settings, deps, vault, targetCount }, path) =>
			planXlsxNote(path, xlsxUnit(targetCount, settings), settings, vault.vaultName, (ref: OutputRef) => deps.writer.exists(ref)),
		start: (ctx, selected) => {
			ctx.xlsx = new XlsxRun(ctx.settings, selected, { readNote: ctx.deps.readNote, writer: ctx.deps.writer, vault: ctx.vault, labels: xlsxLabels() });
		},
		process: ({ xlsx }, path, signal) => xlsx!.addNote(path, signal),
		finish: ({ xlsx }, results) => xlsx!.finish(results),
	},
	pdf: {
		title: () => t("confirm.titlePdf"),
		plan: ({ settings, deps, vault, combine }, path) => planPdfNote(path, settings, combine, vault.vaultName, (ref: OutputRef) => deps.writer.exists(ref)),
		start: (ctx, selected) => {
			ctx.pdf = new PdfRun(ctx.app, ctx.settings, selected, ctx.manifest ?? { entries: [] }, ctx.combine, {
				writer: ctx.deps.writer,
				readNote: ctx.deps.readNote,
				vault: ctx.vault,
				tocLabel: t("docx.toc"),
				lang: getLanguage(),
			});
		},
		process: ({ pdf }, path, signal) => pdf!.addNote(path, signal),
		finish: ({ pdf }, results) => pdf!.finish(results),
	},
	summary: {
		title: () => t("confirm.titleSummary"),
		plan: ({ settings, deps, vault }) => planSummary(settings, vault.vaultName, t("summary.fileSuffix"), (ref: OutputRef) => deps.writer.exists(ref)),
		start: (ctx) => {
			ctx.summary = new SummaryRun(ctx.settings, { readNote: ctx.deps.readNote, writer: ctx.deps.writer, vault: ctx.vault, labels: xlsxLabels(), summary: summaryLabels() });
		},
		process: ({ summary }, path, signal) => summary!.addNote(path, signal),
		finish: ({ summary }, results) => summary!.finish(results),
	},
};

/**
 * 選んだ形式のモード。2 つ以上なら、形式ごとのモードを順に組み合わせる。ノートの結果は出力のうちいちばん重いもの（D5）。
 * 表がないことは Excel だけの事情なので、ノートのスキップにしない（mergeResults）。
 */
function definitionFor(formats: readonly OutputFormat[]): ModeDefinition {
	const parts = formats.map((f) => MODES[FORMAT_MODES[f]]);
	if (parts.length === 1) return parts[0];
	return {
		title: () => t("confirm.titleFormats", { formats: formats.map((f) => t(`format.${f}`)).join(" / ") }),
		plan: async (ctx, path) => (await Promise.all(parts.map((part) => part.plan(ctx, path)))).flat(),
		start: (ctx, selected) => {
			for (const part of parts) part.start?.(ctx, selected);
		},
		process: async (ctx, path, signal, manifest) => {
			const toFailed = (error: unknown) => failedResult(path, error instanceof Error ? error.message : String(error));
			const results: NoteResult[] = [];
			for (const part of parts) results.push(await part.process(ctx, path, signal, manifest).catch(toFailed));
			return mergeAllResults(results);
		},
		finish: async (ctx, results) => {
			for (const part of parts) await part.finish?.(ctx, results);
		},
	};
}

/** Vault 全体の集計のシートと列の名前（UI の言語に合わせる）。 */
function summaryLabels(): SummaryLabels {
	return {
		fileSuffix: t("summary.fileSuffix"),
		propertiesSheet: t("summary.properties"),
		tasksSheet: t("summary.tasks"),
		dataviewSheet: t("summary.dataview"),
		note: t("summary.note"),
		status: t("summary.status"),
		task: t("summary.task"),
		due: t("summary.due"),
		priority: t("summary.priority"),
		heading: t("summary.heading"),
		open: t("summary.open"),
		done: t("summary.done"),
		priorities: [t("summary.priority.highest"), t("summary.priority.high"), t("summary.priority.medium"), t("summary.priority.low"), t("summary.priority.lowest")],
	};
}

/** .xlsx の目次シートなどの文字（UI の言語に合わせる）。 */
function xlsxLabels(): XlsxLabels {
	return {
		toc: t("xlsx.toc"),
		sheet: t("xlsx.toc.sheet"),
		source: t("xlsx.toc.source"),
		heading: t("xlsx.toc.heading"),
		tableCount: t("xlsx.toc.tables"),
		column: (n) => t("xlsx.column", { n: String(n) }),
		table: (n) => t("xlsx.table", { n: String(n) }),
		body: t("xlsx.body"),
	};
}

/** テンプレートのバイト列。絶対パスならファイルシステムから、それ以外は Vault の中から読む。 */
async function readTemplateBytes(app: App, path: string): Promise<Uint8Array> {
	if (nodePath.isAbsolute(path)) return new Uint8Array(await fs.readFile(path));
	return new Uint8Array(await app.vault.adapter.readBinary(normalizePath(path)));
}

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

/** 確認画面と結果画面を出さずに実行する（開発用の自動実行: dev-automation.ts）。 */
export interface AutoRunOptions {
	/** この実行だけに使う設定の上書き（保存しない） */
	settings?: Partial<PluginSettings>;
	/** 1 フォルダを 1 つの .docx にまとめる（C-8） */
	combine?: boolean;
}

export interface RunReport {
	end: RunOutcomeEnd;
	results: NoteResult[];
	runWarnings: Warning[];
}

type RunOutcomeEnd = Awaited<ReturnType<typeof runSequential>>["end"];

/**
 * 書き出しを実行する。auto を渡すと、確認画面ではすべての候補を選んだことにし、結果画面を出さずに結果を返す。
 * 実行しなかったとき（実行中・対象なし・取り消し）は null。
 */
export async function runExport(host: ExportHost, mode: ExportMode, source: TargetSource, auto?: AutoRunOptions): Promise<RunReport | null> {
	if (running) {
		new Notice(t("notice.alreadyRunning"));
		return null;
	}
	const { app } = host;
	if (source.kind === "active" && !(app.workspace.getActiveFile()?.extension === "md")) {
		new Notice(t("notice.noActiveNote"));
		return null;
	}
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return null; // isDesktopOnly なので通常は来ない
	// 実行中に設定が変わっても影響しないよう、写しを使う
	const settings: PluginSettings = { ...structuredClone(host.settings), ...structuredClone(auto?.settings ?? {}) };
	// 確認画面で選ぶ出力形式（Word / Excel / PDF の組み合わせ・R8・H1-PDF）。初期値は、起動したコマンドの形式か設定 defaultFormats
	const initialFormats = formatsOfMode(mode, settings);
	let formats = initialFormats;
	let definition = initialFormats ? definitionFor(initialFormats) : MODES[mode as "mermaid" | "summary"];
	if (settings.outputLocation === "external" && settings.saveMode === "mirror" && settings.externalOutputRoot === "") {
		new Notice(t("notice.externalRootMissing"));
		return null;
	}

	// 01: 変換対象の収集
	const { targets, excluded } = filterTargets(collectCandidates(app, source), settings.includeGlobs, settings.excludeGlobs);
	if (targets.length === 0) {
		new Notice(t("notice.noTargets", { excluded: String(excluded.length) }));
		return null;
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
			return null;
		}

		const readNote = async (path: string): Promise<string> => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error(`not found: ${path}`);
			return app.vault.cachedRead(file);
		};
		const ctx: ModeContext = {
			settings,
			app,
			deps: { readNote, renderer, cache, writer },
			vault: await createVaultEnvironment(app),
			selected: new Set(),
			targetCount: targets.length,
			combine: auto ? (auto.combine ?? false) : settings.defaultCombine,
		};

		// 02: 実行前の確認画面（ドライラン）
		const outputLabel =
			settings.saveMode === "sameFolder"
				? t("settings.saveMode.sameFolder")
				: settings.outputLocation === "external"
					? settings.externalOutputRoot
					: `${settings.outputRoot}/`;
		const selected = auto
			? targets
			: await confirmTargets(app, {
					title: definition.title(),
					targets,
					excludedCount: excluded.length,
					outputLabel,
					plan: (path) => definition.plan(ctx, path),
					...(initialFormats
						? {
								formats: {
									initial: initialFormats,
									combine: settings.defaultCombine,
									title: (chosen: readonly OutputFormat[]) => definitionFor(chosen).title(),
									plan: (chosen: readonly OutputFormat[], combine: boolean, path: string) => definitionFor(chosen).plan({ ...ctx, combine }, path),
								},
							}
						: {}),
				});
		const chosen = Array.isArray(selected) ? { notes: selected } : selected;
		if (!chosen || chosen.notes.length === 0) return null;
		if (chosen.formats) {
			formats = chosen.formats;
			definition = definitionFor(chosen.formats);
		}
		if (chosen.combine !== undefined) ctx.combine = chosen.combine;
		const notes = chosen.notes;
		ctx.selected = new Set(notes);

		// 10: マニフェストは開始時に 1 回だけ読む（D4）
		const { snapshot, warnings: loadWarnings } = await store.load();
		ctx.manifest = snapshot;
		const runWarnings: Warning[] = [...loadWarnings];
		// Word のテンプレート（C-1b）: 読めなければ内蔵のスタイルで続け、実行の警告にする。結合出力の準備（start）より前に読む
		if (settings.wordTemplatePath !== "" && formats?.includes("word")) {
			try {
				ctx.template = readTemplate(await readTemplateBytes(app, settings.wordTemplatePath));
			} catch (error) {
				runWarnings.push({ code: "templateFailed", detail: `${settings.wordTemplatePath}: ${error instanceof Error ? error.message : String(error)}` });
			}
		}
		definition.start?.(ctx, notes);

		// 03: 1 件ずつ順に変換
		const progress = new ProgressNotice();
		// PDF は Obsidian の表示で描くので、実行の間だけライトテーマにする（H1-PDF）
		const restoreTheme = formats?.includes("pdf") ? useLightTheme() : () => undefined;
		let outcome;
		try {
			outcome = await runSequential({
				notes,
				processNote: (path, signal) => definition.process(ctx, path, signal, snapshot),
				timeoutMs: settings.timeoutSeconds * 1000,
				onError: settings.onError,
				isCancelled: progress.isCancelled,
				onProgress: (done, total, path) => progress.update(done, total, path),
				timers: { set: (callback, ms) => window.setTimeout(callback, ms), clear: (handle) => window.clearTimeout(handle as number) },
			});
			// 束ねる出力（1 フォルダ = 1 ブック）を完成させる。中断・fail-fast でも処理済みの分で完成させる
			await definition.finish?.(ctx, outcome.results);
		} finally {
			restoreTheme();
			progress.hide();
		}

		// 10: 実行の最後に 1 回だけ保存する（中断したときも、書き込んだ分は記録する）
		try {
			await store.save(applyResults(snapshot, outcome.results, new Date().toISOString()));
		} catch (error) {
			runWarnings.push({ code: "manifestSaveFailed", detail: String(error) });
		}
		await cache.evict().catch(() => undefined);

		const report: RunReport = { end: outcome.end, results: outcome.results, runWarnings };
		if (!auto) showReport(app, report);
		return report;
	} finally {
		running = false;
	}
}
