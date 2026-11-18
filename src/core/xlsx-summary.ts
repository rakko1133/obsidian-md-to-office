// Vault 全体の集計（A-34・フェーズ 4b）。Obsidian API に依存しない。
// ノートごとに frontmatter・タスク・Dataview の結果を集め、最後に 1 つのブック `{Vault 名}_集計.xlsx` にまとめる。
import type { PhrasingContent, RootContent } from "mdast";
import { writeWithConflictPolicy, type PlannedOutput, type VaultEnvironment } from "./docx-export";
import type { OutputWriter } from "./mermaid-export";
import { obsidianOpenUri } from "./note-assembly";
import { joinPath, noteBaseName, outputDirFor, plannedAction } from "./output-plan";
import { aggregateStatus } from "./run";
import type { PluginSettings } from "./settings";
import type { NoteResult, OutputRef, Warning } from "./types";
import { XlsxBook, tablesOf, type XlsxLabels, type XlsxTable } from "./xlsx-render";

/** 集計のシートと列の名前（UI の言語に合わせる）。 */
export interface SummaryLabels {
	/** ファイル名の後ろ（`{Vault 名}_集計.xlsx` の「集計」） */
	fileSuffix: string;
	propertiesSheet: string;
	tasksSheet: string;
	dataviewSheet: string;
	note: string;
	status: string;
	task: string;
	due: string;
	priority: string;
	heading: string;
	open: string;
	done: string;
	/** 優先度: 🔺 ⏫ 🔼 🔽 ⏬ の順 */
	priorities: readonly [string, string, string, string, string];
}

/** ノートから読み取ったタスク 1 つ（A-34）。 */
export interface TaskItem {
	/** `[ ]` の中の文字 */
	mark: string;
	text: string;
	/** 📅 の日付（YYYY-MM-DD） */
	due?: string;
	/** 0 = 🔺 最高 … 4 = ⏬ 最低 */
	priority?: number;
	heading?: string;
}

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.*)$/u;
const HEADING_LINE = /^#{1,6}\s+(.*?)\s*#*\s*$/u;
const FENCE = /^\s*(`{3,}|~{3,})/u;
const PRIORITY_MARKS = ["🔺", "⏫", "🔼", "🔽", "⏬"] as const;
const DATE_FIELD = /\s*(?:📅|⏳|🛫|➕|✅|❌)️?\s*\d{4}-\d{2}-\d{2}/gu;
const PRIORITY_FIELD = /\s*(?:🔺|⏫|🔼|🔽|⏬)️?/gu;
const RECURRENCE_FIELD = /\s*🔁️?[^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬🆔⛔]*/gu;
const ID_FIELD = /\s*(?:🆔|⛔)️?\s*[\w,-]+/gu;
const BLOCK_ID = /\s+\^[\w-]+$/u;

/** ノートの Markdown からタスクを読み取る（A-34）。frontmatter とコードブロックの中は数えない。Tasks プラグインの記号は本文から取り除く。 */
export function extractTasks(markdown: string): TaskItem[] {
	const tasks: TaskItem[] = [];
	const lines = markdown.split(/\r?\n/);
	let i = 0;
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((l, n) => n > 0 && (l.trim() === "---" || l.trim() === "..."));
		if (end > 0) i = end + 1;
	}
	let fence: string | null = null;
	let heading: string | undefined;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		const f = FENCE.exec(line);
		if (fence !== null) {
			if (f && f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
			continue;
		}
		if (f) {
			fence = f[1]!;
			continue;
		}
		const h = HEADING_LINE.exec(line);
		if (h) {
			heading = h[1]!.trim() || undefined;
			continue;
		}
		const m = TASK_LINE.exec(line);
		if (!m) continue;
		const raw = m[2]!;
		const due = /📅️?\s*(\d{4}-\d{2}-\d{2})/u.exec(raw)?.[1];
		const priority = PRIORITY_MARKS.findIndex((p) => raw.includes(p));
		const text = raw.replace(DATE_FIELD, "").replace(RECURRENCE_FIELD, "").replace(ID_FIELD, "").replace(PRIORITY_FIELD, "").replace(BLOCK_ID, "").trim();
		tasks.push({ mark: m[1]!, text, ...(due ? { due } : {}), ...(priority >= 0 ? { priority } : {}), ...(heading ? { heading } : {}) });
	}
	return tasks;
}

/** ノートの Markdown から dataview / dataviewjs のコードブロックを取り出す（A-34）。 */
export function dataviewBlocks(markdown: string): { lang: string; source: string }[] {
	const blocks: { lang: string; source: string }[] = [];
	const lines = markdown.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/u.exec(lines[i]!);
		if (!open) continue;
		const fence = open[1]!;
		const lang = open[2]!.toLowerCase();
		const body: string[] = [];
		let j = i + 1;
		for (; j < lines.length; j++) {
			const close = FENCE.exec(lines[j]!);
			if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length && lines[j]!.trim() === close[1]) break;
			body.push(lines[j]!);
		}
		if (lang === "dataview" || lang === "dataviewjs") blocks.push({ lang, source: body.join("\n") });
		i = j;
	}
	return blocks;
}

/** frontmatter の値をセルの文字にする（配列は `, ` でつなぐ）。 */
export function frontmatterText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.map(frontmatterText).filter((v) => v !== "").join(", ");
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** 集計のブックの出力先（R8）: 出力ルートの直下（同一フォルダモードでは Vault の直下）に `{Vault 名}_集計.xlsx`。 */
export function summaryOutputRef(settings: Pick<PluginSettings, "saveMode" | "outputLocation" | "outputRoot">, vaultName: string, suffix: string): OutputRef {
	const dir = outputDirFor("note.md", settings);
	return { location: dir.location, path: joinPath(dir.path, `${vaultName || "Vault"}_${suffix}.xlsx`) };
}

export async function planSummary(settings: PluginSettings, vaultName: string, suffix: string, exists: (ref: OutputRef) => Promise<boolean>): Promise<PlannedOutput[]> {
	const output = summaryOutputRef(settings, vaultName, suffix);
	return [{ output, action: plannedAction(await exists(output), false, settings.onConflict) }];
}

export interface SummaryRunDeps {
	readNote(notePath: string): Promise<string>;
	writer: OutputWriter;
	vault?: VaultEnvironment;
	labels: XlsxLabels;
	summary: SummaryLabels;
}

interface NoteRows {
	notePath: string;
	frontmatter?: Readonly<Record<string, unknown>>;
	tasks: TaskItem[];
	dataview: XlsxTable[];
}

/** 1 回の集計の状態。ノートごとに addNote で集め、finish でブックにして書き込む。 */
export class SummaryRun {
	private readonly notes: NoteRows[] = [];

	constructor(
		private readonly settings: PluginSettings,
		private readonly deps: SummaryRunDeps,
	) {}

	get output(): OutputRef {
		return summaryOutputRef(this.settings, this.deps.vault?.vaultName ?? "", this.deps.summary.fileSuffix);
	}

	/** ノート 1 件の frontmatter・タスク・Dataview の結果を集める。集めるものがなければ成功（出力なし）にする。 */
	async addNote(notePath: string, signal: AbortSignal): Promise<NoteResult> {
		const vault = this.deps.vault;
		const markdown = await this.deps.readNote(notePath);
		const warnings: Warning[] = [];
		const frontmatter = vault?.frontmatter?.(notePath);
		const tasks = extractTasks(markdown);
		const dataview: XlsxTable[] = [];
		for (const block of dataviewBlocks(markdown)) {
			if (!vault?.renderableLanguage?.(block.lang) || !vault.renderBlock) {
				warnings.push({ code: "pluginMissing", detail: block.lang });
				continue;
			}
			let nodes: RootContent[] | null = null;
			try {
				nodes = await vault.renderBlock(block.lang, block.source, notePath, signal);
			} catch (error) {
				if (signal.aborted) throw error;
				warnings.push({ code: "renderFailed", detail: `${block.lang}: ${error instanceof Error ? error.message : String(error)}` });
				continue;
			}
			const firstLine = block.source.split("\n").find((l) => l.trim() !== "")?.trim() ?? block.lang;
			for (const table of tablesOf({ type: "root", children: nodes ?? [] })) dataview.push({ ...table, title: `${noteBaseName(notePath)}: ${firstLine}` });
		}
		if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
		const hasFrontmatter = frontmatter !== undefined && Object.keys(frontmatter).length > 0;
		if (hasFrontmatter || tasks.length > 0 || dataview.length > 0) this.notes.push({ notePath, ...(hasFrontmatter ? { frontmatter } : {}), tasks, dataview });
		return { notePath, status: "success", files: [], warnings, deleted: [] };
	}

	/** ブックにして書き込み、結果を行を出したノートに付ける（中断・fail-fast でも、集めた分で作る）。 */
	async finish(results: NoteResult[]): Promise<void> {
		if (this.notes.length === 0) return;
		const { summary, labels } = this.deps;
		const vaultName = this.deps.vault?.vaultName ?? "";
		const link = (path: string): PhrasingContent[] => [{ type: "link", url: obsidianOpenUri(vaultName, path), title: null, children: [{ type: "text", value: noteBaseName(path) }] }];
		const text = (value: string): PhrasingContent[] => (value === "" ? [] : [{ type: "text", value }]);

		const book = new XlsxBook({ sheetUnit: "perNote", asTable: this.settings.excelAsTable, labels, noteUri: (p) => obsidianOpenUri(vaultName, p) });
		const sheet = (name: string, tables: XlsxTable[]) => {
			if (tables.length > 0 && tables.some((t) => t.rows.length > 0)) book.addNote({ notePath: "", noteName: name, tables });
		};

		// プロパティ: 1 ノート = 1 行。キーは最初に出てきた順
		const withFm = this.notes.filter((n) => n.frontmatter);
		const keys: string[] = [];
		for (const n of withFm) for (const k of Object.keys(n.frontmatter!)) if (!keys.includes(k)) keys.push(k);
		sheet(summary.propertiesSheet, [
			{
				align: [null, ...keys.map(() => null)],
				header: [text(summary.note), ...keys.map((k) => text(k))],
				rows: withFm.map((n) => [link(n.notePath), ...keys.map((k) => text(frontmatterText(n.frontmatter![k])))]),
			},
		]);

		// タスク: 1 タスク = 1 行
		const status = (mark: string) => (mark === " " ? summary.open : mark.toLowerCase() === "x" ? summary.done : mark);
		sheet(summary.tasksSheet, [
			{
				align: [null, null, null, null, null, null],
				header: [summary.status, summary.task, summary.due, summary.priority, summary.note, summary.heading].map(text),
				rows: this.notes.flatMap((n) =>
					n.tasks.map((t) => [
						text(status(t.mark)),
						text(t.text),
						text(t.due ?? ""),
						text(t.priority !== undefined ? summary.priorities[t.priority]! : ""),
						link(n.notePath),
						text(t.heading ?? ""),
					]),
				),
			},
		]);

		// Dataview: 結果の表を「ノート名: クエリの 1 行目」を表題にして縦に並べる
		sheet(summary.dataviewSheet, this.notes.flatMap((n) => n.dataview));

		if (book.sheetCount === 0) return;
		let file;
		try {
			const bytes = await book.finish({ title: `${vaultName}_${summary.fileSuffix}`, creator: this.settings.authorName });
			file = await writeWithConflictPolicy(this.output, bytes, this.settings.onConflict, this.deps, new AbortController().signal, "xlsx");
		} catch (error) {
			file = { output: this.output, kind: "xlsx" as const, status: "failed" as const, reason: error instanceof Error ? error.message : String(error) };
		}
		const contributors = new Set(this.notes.map((n) => n.notePath));
		for (const result of results) {
			if (!contributors.has(result.notePath) || result.status === "failed") continue;
			result.files.push(file);
			result.status = aggregateStatus(result.files);
		}
	}
}
