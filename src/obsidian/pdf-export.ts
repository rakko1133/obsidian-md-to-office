// PDF 出力の実行（H1-PDF・フェーズ 7）。export-runner のモード pdf から呼ぶ。
// - 1 ノート = 1 PDF: ノートの処理（addNote）で印刷して書き込む
// - 結合出力（C-8 の考え方）: ノートの処理では章を集めるだけにし、全ノートの処理の後（finish）にフォルダごとに印刷する
import type { App } from "obsidian";
import { today, writeWithConflictPolicy, type VaultEnvironment } from "../core/docx-export";
import { mocLinks, mocPathOf, orderChapters } from "../core/docx-combine";
import { mapFrontmatter, valueToText } from "../core/frontmatter";
import type { MermaidExportDeps } from "../core/mermaid-export";
import { noteBaseName, refKey } from "../core/output-plan";
import { pdfConvertedNotes, pdfPageOptions, pdfTargetRef, pdfTextCssProps } from "../core/pdf-export";
import { aggregateStatus } from "../core/run";
import type { PluginSettings } from "../core/settings";
import type { FileResult, ManifestSnapshot, NoteResult, OutputRef } from "../core/types";
import { printPdf, type PdfPrintJob } from "./pdf-print";
import { timed } from "../core/profile";

export interface PdfRunDeps extends Pick<MermaidExportDeps, "writer" | "readNote"> {
	vault: VaultEnvironment;
	/** 目次の見出しの文字（UI の言語） */
	tocLabel: string;
	/** 文書の言語（BCP 47） */
	lang: string;
}

interface Group {
	output: OutputRef;
	folderName: string;
	chapters: { notePath: string; title: string; order?: number }[];
	contributors: string[];
	moc?: string;
}

export class PdfRun {
	private readonly selected: ReadonlySet<string>;
	private readonly converted: ReadonlySet<string>;
	private readonly groups = new Map<string, Group>();

	constructor(
		private readonly app: App,
		private readonly settings: PluginSettings,
		selected: readonly string[],
		manifest: ManifestSnapshot,
		private readonly combine: boolean,
		private readonly deps: PdfRunDeps,
	) {
		this.selected = new Set(selected);
		this.converted = pdfConvertedNotes(selected, manifest);
	}

	private outputOf(notePath: string): OutputRef {
		return pdfTargetRef(notePath, this.settings, { combine: this.combine, vaultName: this.deps.vault.vaultName, selected: this.selected });
	}

	private frontmatter(notePath: string): Readonly<Record<string, unknown>> | undefined {
		return this.deps.vault.frontmatter?.(notePath);
	}

	private titleOf(notePath: string): string {
		return mapFrontmatter(this.frontmatter(notePath)).title ?? noteBaseName(notePath);
	}

	private job(output: OutputRef, chapters: PdfPrintJob["chapters"], doc: { title: string; author?: string; date?: string; combined: boolean }, signal?: AbortSignal): PdfPrintJob {
		const s = this.settings;
		const toc = s.tableOfContents === "always" || (s.tableOfContents === "combined" && doc.combined);
		return {
			output,
			chapters,
			combined: doc.combined,
			title: doc.title,
			...(doc.author ? { author: doc.author } : {}),
			date: doc.date || today(),
			cover: s.coverPage,
			...(toc ? { tocLabel: this.deps.tocLabel } : {}),
			headerTitle: s.headerTitle,
			footerPageNumber: s.footerPageNumber,
			page: pdfPageOptions(s),
			textCss: pdfTextCssProps(s),
			lang: this.deps.lang,
			// 別の PDF になるノート（今回の対象か、記録に PDF として残るノート）だけ、リンク先にする
			linkTarget: (path) => (this.converted.has(path) ? this.outputOf(path) : null),
			...(signal ? { signal } : {}),
		};
	}

	/** ノート 1 件: 1 ノート = 1 PDF なら印刷して書き込む。結合出力なら章として集める。 */
	async addNote(notePath: string, signal: AbortSignal): Promise<NoteResult> {
		if (this.combine) return this.collect(notePath);
		const raw = this.frontmatter(notePath);
		const fm = mapFrontmatter(raw);
		const output = this.outputOf(notePath);
		const title = fm.title ?? noteBaseName(notePath);
		const author = fm.author ?? this.settings.authorName;
		const printed = await timed("pdf/print", () =>
			printPdf(this.app, this.job(output, [{ notePath, title }], { title, author, date: valueToText(raw?.date), combined: false }, signal)),
		);
		if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
		const file = await timed("pdf/write", () => writeWithConflictPolicy(output, printed.data, this.settings.onConflict, this.deps, signal, "pdf"));
		return { notePath, status: aggregateStatus([file]), files: [file], warnings: printed.warnings, deleted: [] };
	}

	private collect(notePath: string): NoteResult {
		const output = this.outputOf(notePath);
		const key = refKey(output);
		let group = this.groups.get(key);
		if (!group) {
			const slash = notePath.lastIndexOf("/");
			const folder = slash < 0 ? "" : notePath.slice(0, slash);
			group = { output, folderName: folder === "" ? this.deps.vault.vaultName || "Vault" : folder.slice(folder.lastIndexOf("/") + 1), chapters: [], contributors: [] };
			this.groups.set(key, group);
		}
		group.contributors.push(notePath);
		// MOC の順（C-8）では、MOC ノートは並び順の元にするだけで、章にしない
		if (this.settings.combineOrder === "moc" && notePath === mocPathOf(notePath, this.deps.vault.vaultName)) {
			group.moc = notePath;
		} else {
			const orderText = valueToText(this.frontmatter(notePath)?.order);
			const order = Number(orderText);
			group.chapters.push({ notePath, title: this.titleOf(notePath), ...(orderText !== "" && Number.isFinite(order) ? { order } : {}) });
		}
		return { notePath, status: "success", files: [], warnings: [], deleted: [] };
	}

	/** 結合出力: フォルダごとに章を並べて印刷し、結果を章のノートに付ける（中断・fail-fast でも処理済みの章で作る）。 */
	async finish(results: NoteResult[]): Promise<void> {
		const signal = new AbortController().signal;
		for (const group of this.groups.values()) {
			if (group.chapters.length === 0) continue;
			let file: FileResult;
			const warnings: NoteResult["warnings"] = [];
			try {
				const moc = group.moc
					? mocLinks(await this.deps.readNote(group.moc), group.moc, (link, source) => this.deps.vault.resolveLink(link, source))
					: [];
				// 章にできたノート（失敗したノートは除く）
				const failed = new Set(results.filter((r) => r.status === "failed").map((r) => r.notePath));
				const chapters = orderChapters(group.chapters.filter((c) => !failed.has(c.notePath)), this.settings.combineOrder, moc);
				if (chapters.length === 0) continue;
				const mocRaw = group.moc ? this.frontmatter(group.moc) : undefined;
				const fm = mapFrontmatter(mocRaw);
				const title = fm.title ?? group.folderName;
				const author = fm.author ?? this.settings.authorName;
				const printed = await printPdf(
					this.app,
					this.job(group.output, chapters.map((c) => ({ notePath: c.notePath, title: c.title })), { title, author, date: valueToText(mocRaw?.date), combined: true }),
				);
				warnings.push(...printed.warnings);
				file = await writeWithConflictPolicy(group.output, printed.data, this.settings.onConflict, this.deps, signal, "pdf");
			} catch (error) {
				file = { output: group.output, kind: "pdf", status: "failed", reason: error instanceof Error ? error.message : String(error) };
			}
			for (const result of results) {
				if (!group.contributors.includes(result.notePath) || result.status === "failed") continue;
				result.files.push(file);
				result.status = aggregateStatus(result.files);
				if (file.status === "failed" && file.reason) result.reason = file.reason;
				// 描画の警告は、その章のノートに付ける
				result.warnings.push(...warnings.filter((w) => w.detail?.startsWith(`${result.notePath}:`)));
			}
		}
	}
}
