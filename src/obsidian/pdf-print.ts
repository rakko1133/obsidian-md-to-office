// PDF の描画と印刷（H1-PDF・フェーズ 7）。Electron に触れるのはこのファイルだけ。
// Obsidian 本体の「PDF にエクスポート」と同じ作り: body 直下の .print 要素に、ノートを読みモードと同じ仕組み
// （MarkdownRenderer.render）で描き、今のウィンドウの webContents.printToPDF() を呼ぶ。
// Obsidian の印刷用の CSS（@media print）が .print 以外を隠す。画面では .print を画面の外に置く（styles.css）。
// 表紙は本文と別に印刷し（ヘッダー・フッターを付けないため）、pdf-postprocess で本文の先頭に差し込む。
import { Component, MarkdownRenderer, TFile, type App } from "obsidian";
import { obsidianOpenUri } from "../core/note-assembly";
import { headingKey, headingOfSubpath, pdfPrintableHeightPx, pdfRelativePath, type PdfPageOptions } from "../core/pdf-export";
import { pdfLinkHref, postprocessPdf } from "../core/pdf-postprocess";
import type { OutputRef, Warning } from "../core/types";
import { waitForQuiet } from "./plugin-render";
import { timed } from "../core/profile";

const ROOT_CLASS = "batch-office-export-pdf-root";
const CHAPTER_CLASS = "batch-office-export-pdf-chapter";
const CHAPTER_TITLE_CLASS = "batch-office-export-pdf-chapter-title";
const HIDDEN_CLASS = "batch-office-export-pdf-hidden";

export interface PdfPrintJob {
	/** この PDF の出力先（別の PDF への相対リンクの起点） */
	output: OutputRef;
	/** 章（ノート）の並び。1 ノート = 1 PDF なら 1 つ */
	chapters: readonly { notePath: string; title: string }[];
	/** 結合出力（章の題を見出し 1 にし、ノートの見出しを 1 段下げる） */
	combined: boolean;
	/** 文書のタイトル（文書プロパティ・ヘッダー・表紙） */
	title: string;
	author?: string;
	/** 表紙の日付 */
	date: string;
	cover: boolean;
	/** 目次の見出しの文字。なければ目次を入れない */
	tocLabel?: string;
	headerTitle: boolean;
	footerPageNumber: boolean;
	page: PdfPageOptions;
	/** BCP 47 の言語タグ */
	lang: string;
	/** ノートが入る別の PDF の出力先。PDF にならないノートなら null（リンクは文字だけ） */
	linkTarget(notePath: string): OutputRef | null;
	/** ノートのタイムアウト（D1）。印刷そのものは止められないので、描画の途中で確かめる */
	signal?: AbortSignal;
}

export interface PdfPrintResult {
	data: Uint8Array;
	pages: number;
	warnings: Warning[];
}

interface WebContents {
	printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
}

/** 今のウィンドウの webContents（Electron の remote）。デスクトップ版だけ（G4: isDesktopOnly）。 */
function currentWebContents(): WebContents {
	const req = (window as unknown as { require?: (id: string) => unknown }).require;
	const electron = req?.("electron") as { remote?: { getCurrentWebContents?: () => WebContents } } | undefined;
	const contents = electron?.remote?.getCurrentWebContents?.();
	if (!contents || typeof contents.printToPDF !== "function") throw new Error("printToPDF is not available in this version of Obsidian");
	return contents;
}

/**
 * PDF 出力の間だけ、Obsidian をライトテーマにする（戻す関数を返す）。
 * Obsidian の配色の変数は body のテーマのクラスで決まり、Mermaid も描くときのテーマで色を決めるので、
 * 印刷用の要素だけをライトにすることはできない（試作で確認）。実行の最初から最後まで 1 回だけ切り替える。
 */
export function useLightTheme(): () => void {
	const body = activeDocument.body;
	if (!body.hasClass("theme-dark")) return () => undefined;
	body.removeClass("theme-dark");
	body.addClass("theme-light");
	return () => {
		body.removeClass("theme-light");
		body.addClass("theme-dark");
	};
}

/** 印刷は 1 つずつ（.print 要素は同時に 1 つだけ置ける）。 */
let queue: Promise<unknown> = Promise.resolve();

export function printPdf(app: App, job: PdfPrintJob): Promise<PdfPrintResult> {
	const run = queue.then(() => printNow(app, job));
	queue = run.catch(() => undefined);
	return run;
}

async function printNow(app: App, job: PdfPrintJob): Promise<PdfPrintResult> {
	const warnings: Warning[] = [];
	const doc = activeDocument;
	const root = doc.body.createDiv({ cls: ["print", ROOT_CLASS] });
	// 画像・図の最大の高さ（styles.css で使う）
	root.setCssProps({ "--batch-office-export-pdf-max-height": `${pdfPrintableHeightPx(job.page)}px` });
	const component = new Component();
	component.load();
	try {
		const cover = job.cover ? renderCover(root, job) : null;
		const view = root.createDiv({ cls: "markdown-preview-view markdown-rendered" });
		const toc = job.tocLabel !== undefined ? view.createDiv({ cls: "batch-office-export-pdf-toc" }) : null;

		// 章を描く。見出しに id を付け、リンクの行き先の表を作る
		const chapterIds = new Map<string, string>();
		const headingIds = new Map<string, Map<string, string>>();
		const chapterEls: { notePath: string; el: HTMLElement }[] = [];
		let headingCount = 0;
		for (const [index, chapter] of job.chapters.entries()) {
			throwIfAborted(job.signal);
			const file = app.vault.getAbstractFileByPath(chapter.notePath);
			if (!(file instanceof TFile)) throw new Error(`not found: ${chapter.notePath}`);
			const el = view.createDiv({ cls: CHAPTER_CLASS });
			el.id = `boe-ch${index + 1}`;
			if (job.combined) el.createEl("h1", { text: chapter.title, cls: CHAPTER_TITLE_CLASS, attr: { id: `${el.id}-title` } });
			const body = el.createDiv();
			const markdown = await app.vault.cachedRead(file);
			await timed("pdf/markdownRender", () => MarkdownRenderer.render(app, markdown, body, chapter.notePath, component));
			try {
				await timed("pdf/waitForQuiet", () => waitForQuiet(body, job.signal));
			} catch (error) {
				throwIfAborted(job.signal);
				// 描画が止まらない（時間切れ）ときは、その時点の内容で続ける
				warnings.push({ code: "renderFailed", detail: `${chapter.notePath}: ${error instanceof Error ? error.message : String(error)}` });
			}
			if (job.combined) demoteHeadings(body);
			// Mermaid 図の拡大・縮小のボタン（Obsidian 1.15 以降）は印刷しない
			for (const control of Array.from(body.querySelectorAll(".pele-zoom"))) control.remove();
			const ids = new Map<string, string>();
			for (const h of Array.from(body.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))) {
				const id = `boe-h${++headingCount}`;
				h.id = id;
				const key = headingKey(h.dataset.heading ?? h.textContent ?? "");
				if (!ids.has(key)) ids.set(key, id);
			}
			chapterIds.set(chapter.notePath, el.id);
			headingIds.set(chapter.notePath, ids);
			chapterEls.push({ notePath: chapter.notePath, el: body });
		}

		for (const { notePath, el } of chapterEls) rewriteLinks(app, el, notePath, job, chapterIds, headingIds);
		if (toc) renderToc(toc, view, job.tocLabel ?? "");

		const contents = currentWebContents();
		const base = {
			pageSize: job.page.pageSize,
			landscape: job.page.landscape,
			scale: job.page.scale,
			margins: job.page.margins,
			printBackground: true,
			generateTaggedPDF: true,
		};
		let coverPdf: Uint8Array | undefined;
		if (cover) {
			view.addClass(HIDDEN_CLASS);
			coverPdf = await timed("pdf/printToPDF/cover", () => contents.printToPDF({ ...base, displayHeaderFooter: false }));
			view.removeClass(HIDDEN_CLASS);
			cover.addClass(HIDDEN_CLASS);
		}
		const decorated = job.headerTitle || job.footerPageNumber;
		const bodyPdf = await timed("pdf/printToPDF/body", () => contents.printToPDF({
			...base,
			generateDocumentOutline: true,
			displayHeaderFooter: decorated,
			...(decorated
				? {
						headerTemplate: job.headerTitle ? label(escapeHtml(job.title)) : "<span></span>",
						footerTemplate: job.footerPageNumber ? label('<span class="pageNumber"></span> / <span class="totalPages"></span>') : "<span></span>",
					}
				: {}),
		}));
		const post = await timed("pdf/postprocess", () => postprocessPdf(toBytes(bodyPdf), {
			...(coverPdf ? { cover: toBytes(coverPdf) } : {}),
			title: job.title,
			...(job.author ? { author: job.author } : {}),
			lang: job.lang,
		}));
		return { data: post.data, pages: post.pages, warnings };
	} finally {
		component.unload();
		root.remove();
	}
}

function renderCover(root: HTMLElement, job: PdfPrintJob): HTMLElement {
	const cover = root.createDiv({ cls: "markdown-preview-view markdown-rendered batch-office-export-pdf-cover" });
	cover.createEl("h1", { text: job.title });
	if (job.author) cover.createEl("p", { text: job.author });
	cover.createEl("p", { text: job.date });
	return cover;
}

/** 結合出力: ノートの見出しを 1 段下げる（章の題が見出し 1。H6 はそのまま）。 */
function demoteHeadings(container: HTMLElement): void {
	for (const h of Array.from(container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5"))) {
		const level = Number(h.tagName.slice(1));
		const next = activeDocument.createElement(`h${level + 1}`);
		for (const attr of Array.from(h.attributes)) next.setAttribute(attr.name, attr.value);
		while (h.firstChild) next.appendChild(h.firstChild);
		h.replaceWith(next);
	}
}

/**
 * 内部リンクの行き先を決める（H1-PDF）。
 * - 同じ PDF の中のノート: 見出し（なければノートの先頭）への PDF 内リンク
 * - 別の PDF になるノート: その PDF への相対リンク（目印の URL。後処理で GoToR にする）
 * - ノート以外のファイル（PDF・画像など）: obsidian://open（A-22）
 * - それ以外（変換対象外・解決できない）: 文字だけ
 */
function rewriteLinks(
	app: App,
	container: HTMLElement,
	notePath: string,
	job: PdfPrintJob,
	chapterIds: ReadonlyMap<string, string>,
	headingIds: ReadonlyMap<string, ReadonlyMap<string, string>>,
): void {
	for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
		const target = a.dataset.href ?? a.getAttribute("href") ?? "";
		const hash = target.indexOf("#");
		const linkpath = hash < 0 ? target : target.slice(0, hash);
		const subpath = hash < 0 ? "" : target.slice(hash);
		const dest = linkpath === "" ? app.vault.getAbstractFileByPath(notePath) : app.metadataCache.getFirstLinkpathDest(linkpath, notePath);
		if (!(dest instanceof TFile)) {
			a.removeAttribute("href");
			continue;
		}
		const chapterId = chapterIds.get(dest.path);
		if (chapterId) {
			const heading = headingOfSubpath(subpath);
			const id = (heading !== null ? headingIds.get(dest.path)?.get(headingKey(heading)) : undefined) ?? chapterId;
			a.setAttribute("href", `#${id}`);
			continue;
		}
		if (dest.extension !== "md") {
			a.setAttribute("href", obsidianOpenUri(app.vault.getName(), dest.path));
			continue;
		}
		const other = job.linkTarget(dest.path);
		const relative = other ? pdfRelativePath(job.output, other) : null;
		if (relative) a.setAttribute("href", pdfLinkHref(relative));
		else a.removeAttribute("href");
	}
}

/** 目次: 見出し 1〜3 の一覧（各見出しへのリンク）。ページ番号は付けない（H1-PDF）。 */
function renderToc(toc: HTMLElement, view: HTMLElement, label: string): void {
	toc.createEl("h1", { text: label, cls: "batch-office-export-pdf-toc-title" });
	const list = toc.createEl("ul");
	for (const h of Array.from(view.querySelectorAll<HTMLElement>(`.${CHAPTER_CLASS} :is(h1, h2, h3)`))) {
		if (!h.id) continue;
		const li = list.createEl("li", { cls: `batch-office-export-pdf-toc-${h.tagName.toLowerCase()}` });
		li.createEl("a", { text: h.textContent ?? "", href: `#${h.id}` });
	}
}

function label(html: string): string {
	return `<div style="font-size:9px;width:100%;text-align:center;color:#555;">${html}</div>`;
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** remote から返る Buffer を、ただの Uint8Array にする（pdf-lib に渡すため）。 */
function toBytes(data: Uint8Array): Uint8Array {
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
}
