// ノートを .xlsx にする（04 → 08 → 09 の流れ・フェーズ 4a）と、そのドライラン（02）。
// Obsidian API に依存しない。書き込みは引数の部品に任せる。
// 1 フォルダ = 1 ブックでは、ノートごとにシートを足し（addXlsxNote）、全ノートの処理の後にブックを完成させる（finishXlsxBooks: D7）。
import { writeWithConflictPolicy, type PlannedOutput, type VaultEnvironment } from "./docx-export";
import { mapFrontmatter } from "./frontmatter";
import type { OutputWriter } from "./mermaid-export";
import { assembleNote, obsidianOpenUri, type NoteEnvironment } from "./note-assembly";
import { baseName, dirName, joinPath, noteBaseName, outputDirFor, plannedAction, refKey } from "./output-plan";
import { aggregateStatus } from "./run";
import type { PluginSettings } from "./settings";
import type { FileResult, NoteResult, OutputRef, Warning } from "./types";
import { outlineRows } from "./xlsx-outline";
import { NOTE_LINK_SCHEME, XlsxBook, firstHeading, tablesOf, type XlsxLabels } from "./xlsx-render";

/** Excel の出力単位（R8・D6）。 */
export type XlsxUnit = "single" | "perFolder" | "perNote";

/** 実行するノートの件数と設定から、Excel の出力単位を決める（R8: 1 件なら単一ノート）。 */
export function xlsxUnit(noteCount: number, settings: Pick<PluginSettings, "excelBookUnit">): XlsxUnit {
	if (noteCount === 1) return "single";
	return settings.excelBookUnit === "perNote" ? "perNote" : "perFolder";
}

/** ノートが入るブックの出力先（R8）。1 フォルダ = 1 ブックでは `{フォルダ名}.xlsx`、Vault 直下は `{Vault 名}.xlsx`。 */
export function xlsxOutputRef(notePath: string, unit: XlsxUnit, settings: Pick<PluginSettings, "saveMode" | "outputLocation" | "outputRoot">, vaultName: string): OutputRef {
	const dir = outputDirFor(notePath, settings);
	if (unit !== "perFolder") return { location: dir.location, path: joinPath(dir.path, `${noteBaseName(notePath)}.xlsx`) };
	const folder = dirName(notePath);
	return { location: dir.location, path: joinPath(dir.path, `${folder === "" ? vaultName || "Vault" : baseName(folder)}.xlsx`) };
}

/** ドライラン: ブックの出力先と予定動作（表があるかは構文解析するまで分からないので、作る予定として出す）。 */
export async function planXlsxNote(
	notePath: string,
	unit: XlsxUnit,
	settings: PluginSettings,
	vaultName: string,
	exists: (ref: OutputRef) => Promise<boolean>,
): Promise<PlannedOutput[]> {
	const output = xlsxOutputRef(notePath, unit, settings, vaultName);
	return [{ output, action: plannedAction(await exists(output), false, settings.onConflict) }];
}

interface BookGroup {
	output: OutputRef;
	book: XlsxBook;
	/** 1 フォルダ = 1 ブックのタイトル（フォルダ名） */
	title: string;
	/** シートを足したノート（ブックの結果を付ける） */
	contributors: string[];
}

export interface XlsxRunDeps {
	readNote: (notePath: string) => Promise<string>;
	writer: OutputWriter;
	vault?: VaultEnvironment;
	labels: XlsxLabels;
}

/** 1 回の実行の中で、グループ（ブック）ごとの状態を持つ。 */
export class XlsxRun {
	private readonly groups = new Map<string, BookGroup>();
	readonly unit: XlsxUnit;

	constructor(
		private readonly settings: PluginSettings,
		/** 今回の実行の対象（確認画面で選んだノート） */
		private readonly selected: readonly string[],
		private readonly deps: XlsxRunDeps,
	) {
		this.unit = xlsxUnit(selected.length, settings);
	}

	private outputOf(notePath: string): OutputRef {
		return xlsxOutputRef(notePath, this.unit, this.settings, this.deps.vault?.vaultName ?? "");
	}

	private groupOf(notePath: string): BookGroup {
		const output = this.outputOf(notePath);
		const key = refKey(output);
		let group = this.groups.get(key);
		if (!group) {
			const folder = dirName(notePath);
			group = {
				output,
				book: new XlsxBook({
					sheetUnit: this.settings.excelSheetUnit,
					asTable: this.settings.excelAsTable,
					labels: this.deps.labels,
					noteUri: (path) => obsidianOpenUri(this.deps.vault?.vaultName ?? "", path),
					sourceColumns: this.settings.excelSourceColumns,
				}),
				title: folder === "" ? this.deps.vault?.vaultName || "Vault" : baseName(folder),
				contributors: [],
			};
			this.groups.set(key, group);
		}
		return group;
	}

	/** ノート 1 件の表をブックに足す。単一ノート・1 ノート = 1 ブックでは、ここでブックを完成させて書き込む。 */
	async addNote(notePath: string, signal: AbortSignal): Promise<NoteResult> {
		const vault = this.deps.vault ?? { resolveLink: () => null, fileExists: () => false, vaultName: "" };
		const { calloutColor: _unused, frontmatter: _fm, ...rest } = vault;
		const env: NoteEnvironment = {
			...rest,
			readNote: this.deps.readNote,
			// ノートへのリンクは、ブックを完成させるときに、同じブックならそのシート、それ以外は obsidian://open にする（A-32）
			isConverted: () => true,
			docxLink: (target) => `${NOTE_LINK_SCHEME}${target}`,
		};
		const assembled = await assembleNote(notePath, env, { keepComments: false, downloadExternalImages: this.settings.downloadExternalImages, signal });
		const warnings: Warning[] = [...assembled.warnings];
		const outline = this.settings.excelOutlineMode;
		const tables = tablesOf(assembled.tree);
		// アウトライン形式では、表のないノートもシートを作る（D-1b の括弧書き・A-30）
		if (!outline && tables.length === 0) return { notePath, status: "skipped", reason: "noTables", files: [], warnings, deleted: [] };

		const group = this.groupOf(notePath);
		// タイムアウトしたノートのシートは足さない（D1・D2）
		if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
		const base = { notePath, noteName: noteBaseName(notePath), firstHeading: firstHeading(assembled.tree) };
		warnings.push(...(outline ? group.book.addOutlineNote({ ...base, rows: outlineRows(assembled.tree) }) : group.book.addNote({ ...base, tables })));
		group.contributors.push(notePath);

		if (this.unit === "perFolder") return { notePath, status: "success", files: [], warnings, deleted: [] };
		const fm = mapFrontmatter(vault.frontmatter?.(notePath));
		const file = await this.writeBook(group, { title: fm.title ?? noteBaseName(notePath), creator: fm.author ?? this.settings.authorName }, signal);
		return { notePath, status: aggregateStatus([file]), files: [file], warnings, deleted: [] };
	}

	/**
	 * 1 フォルダ = 1 ブックのブックを完成させて書き込み、結果をシートを足したノートに付ける（D5・D7）。
	 * 中断・fail-fast のときも、処理済みのノートのシートでブックを完成させる（フェーズ 4 の決定）。
	 */
	async finish(results: NoteResult[]): Promise<void> {
		if (this.unit !== "perFolder") return;
		const signal = new AbortController().signal;
		for (const group of this.groups.values()) {
			if (group.book.sheetCount === 0 || group.contributors.length === 0) continue;
			let file: FileResult;
			try {
				file = await this.writeBook(group, { title: group.title, creator: this.settings.authorName }, signal);
			} catch (error) {
				file = { output: group.output, kind: "xlsx", status: "failed", reason: error instanceof Error ? error.message : String(error) };
			}
			for (const result of results) {
				if (!group.contributors.includes(result.notePath) || result.status === "failed") continue;
				result.files.push(file);
				result.status = aggregateStatus(result.files);
				if (file.status === "failed" && file.reason) result.reason = file.reason;
			}
		}
	}

	private async writeBook(group: BookGroup, props: { title: string; creator: string }, signal: AbortSignal): Promise<FileResult> {
		const bytes = await group.book.finish(props);
		return writeWithConflictPolicy(group.output, bytes, this.settings.onConflict, this.deps, signal, "xlsx");
	}
}
