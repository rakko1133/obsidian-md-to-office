// PDF 出力（H1-PDF）の試作（開発用ビルドだけ）。本実装の前に、次のことを Obsidian の中で確かめる。
// - Obsidian 標準の「PDF にエクスポート」と同じ作り（body 直下の .print に読みモードの HTML を描き、@media print で
//   それ以外を隠す）で、今のウィンドウの webContents.printToPDF() から PDF を作れるか
// - しおり（generateDocumentOutline）、フッターのページ番号（footerTemplate）、ヘッダーのタイトル
// - 表紙のページだけヘッダー・フッターを出さない方法（@page :first の余白を 0 にしても消えないことを確かめた）
// 改ページと表紙の CSS は styles.css（.print .batch-office-export-pdf-*）
// - 結合出力（ノートごとに改ページ）と、[[ノート#見出し]] の PDF 内リンク・目次
import { Component, MarkdownRenderer, TFile, TFolder, type App, type TAbstractFile } from "obsidian";

const QUIET_MS = 500;
const MAX_WAIT_MS = 20000;
const MM_PER_INCH = 25.4;

export interface PdfPrototypeOptions {
	/** 1 フォルダ（または指定したノート全部）を 1 つの PDF にまとめる */
	combine?: boolean;
	cover?: boolean;
	toc?: boolean;
	header?: boolean;
	/** 余白（mm）。上下左右 */
	marginMm?: number;
	pageSize?: "A4" | "A3" | "B5" | "Letter";
	landscape?: boolean;
	/** 出力先（Vault 内のフォルダ） */
	outDir?: string;
}

interface PrintToPdf {
	printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
}

function currentWebContents(): PrintToPdf {
	const req = (window as unknown as { require: (id: string) => { remote: { getCurrentWebContents(): PrintToPdf } } }).require;
	return req("electron").remote.getCurrentWebContents();
}

function collectNotes(items: TAbstractFile[]): TFile[] {
	const notes: TFile[] = [];
	const walk = (item: TAbstractFile) => {
		if (item instanceof TFile && item.extension === "md") notes.push(item);
		else if (item instanceof TFolder) for (const child of item.children) walk(child);
	};
	items.forEach(walk);
	return notes.sort((a, b) => a.path.localeCompare(b.path));
}

function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function slug(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, "-");
}

export async function runPdfPrototype(app: App, items: TAbstractFile[], options: PdfPrototypeOptions): Promise<Record<string, unknown>> {
	const notes = collectNotes(items);
	if (notes.length === 0) return { error: "no notes" };
	const outDir = options.outDir ?? "_export/pdf";
	if (!(await app.vault.adapter.exists(outDir))) await app.vault.adapter.mkdir(outDir);
	const groups: { name: string; notes: TFile[] }[] = options.combine
		? [{ name: items.length === 1 ? items[0].name.replace(/\.md$/, "") : "combined", notes }]
		: notes.map((n) => ({ name: n.basename, notes: [n] }));
	const results: Record<string, unknown>[] = [];
	for (const group of groups) {
		const started = Date.now();
		const path = `${outDir}/${group.name}.pdf`;
		const info = await printGroup(app, group.notes, group.name, options);
		await app.vault.adapter.writeBinary(path, info.data.buffer.slice(info.data.byteOffset, info.data.byteOffset + info.data.byteLength) as ArrayBuffer);
		results.push({ path, bytes: info.data.byteLength, ms: Date.now() - started, links: info.links });
	}
	return { results };
}

async function printGroup(app: App, notes: TFile[], title: string, options: PdfPrototypeOptions): Promise<{ data: Uint8Array; links: Record<string, number> }> {
	const body = activeDocument.body;
	const root = body.createDiv({ cls: "print" });
	const view = root.createDiv({ cls: "markdown-preview-view markdown-rendered" });
	const margin = options.marginMm ?? 25;
	const component = new Component();
	component.load();
	const themeDark = body.hasClass("theme-dark");
	const windowTitle = activeDocument.title;
	const links = { anchor: 0, otherPdf: 0, textOnly: 0, external: 0 };
	try {
		if (options.cover) {
			const cover = view.createDiv({ cls: "batch-office-export-pdf-cover" });
			const fm = notes.length === 1 ? app.metadataCache.getFileCache(notes[0])?.frontmatter : undefined;
			cover.createEl("h1", { text: String(fm?.title ?? title) });
			if (fm?.author) cover.createEl("p", { text: String(fm.author) });
			cover.createEl("p", { text: String(fm?.date ?? new Date().toISOString().slice(0, 10)) });
		}
		const toc = options.toc ? view.createDiv({ cls: "batch-office-export-pdf-toc" }) : null;
		const anchors = new Map<string, string>();
		const chapters: { file: TFile; el: HTMLElement }[] = [];
		for (const [index, file] of notes.entries()) {
			const chapter = view.createDiv({ cls: "batch-office-export-pdf-chapter" });
			if (notes.length > 1) chapter.createEl("h1", { text: file.basename, cls: "batch-office-export-pdf-chapter-title" });
			await MarkdownRenderer.render(app, await app.vault.cachedRead(file), chapter, file.path, component);
			await waitForQuiet(chapter);
			// 見出しに id を付ける（PDF 内リンクと目次の行き先）
			const chapterId = `n${index}`;
			chapter.id = chapterId;
			anchors.set(`${file.path}#`, chapterId);
			for (const h of Array.from(chapter.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"))) {
				const text = h.dataset.heading ?? h.textContent ?? "";
				if (h.hasClass("batch-office-export-pdf-chapter-title")) continue;
				const id = `${chapterId}-${slug(text)}`;
				h.id = id;
				anchors.set(`${file.path}#${text}`, id);
			}
			chapters.push({ file, el: chapter });
		}
		// [[ノート#見出し]] を書き換える: 同じ PDF の中なら #id、ほかの変換対象なら {ノート名}.pdf への相対リンク、それ以外は文字だけ
		for (const { file, el } of chapters) {
			for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>("a.internal-link"))) {
				const target = a.dataset.href ?? a.getAttribute("href") ?? "";
				const [linkpath, sub = ""] = target.split("#");
				const dest = linkpath === "" ? file : app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
				const id = dest ? anchors.get(`${dest.path}#${sub}`) : undefined;
				if (id) {
					a.setAttribute("href", `#${id}`);
					links.anchor++;
				} else if (dest && dest.extension === "md" && !options.combine) {
					a.setAttribute("href", `${encodeURI(dest.basename)}.pdf${sub ? `#${encodeURIComponent(slug(sub))}` : ""}`);
					links.otherPdf++;
				} else {
					a.removeAttribute("href");
					links.textOnly++;
				}
			}
			links.external += el.querySelectorAll("a.external-link").length;
		}
		if (toc) {
			toc.createEl("h1", { text: "目次" });
			const list = toc.createEl("ul");
			for (const h of Array.from(view.querySelectorAll<HTMLElement>(".batch-office-export-pdf-chapter h1, .batch-office-export-pdf-chapter h2, .batch-office-export-pdf-chapter h3"))) {
				const level = Number(h.tagName.slice(1));
				const li = list.createEl("li");
				li.style.marginLeft = `${(level - 1) * 1.5}em`;
				const id = h.id || h.closest(".batch-office-export-pdf-chapter")?.id || "";
				li.createEl("a", { text: h.textContent ?? "", href: `#${id}` });
			}
		}
		if (themeDark) { body.removeClass("theme-dark"); body.addClass("theme-light"); };
		const inch = (mm: number) => mm / MM_PER_INCH;
		const label = (text: string) => `<div style="font-size:9px;width:100%;text-align:center;color:#555;">${text}</div>`;
		// PDF の文書プロパティのタイトルは document.title から入る
		activeDocument.title = title;
		const data = await currentWebContents().printToPDF({
			pageSize: options.pageSize ?? "A4",
			landscape: options.landscape ?? false,
			printBackground: true,
			margins: { top: inch(margin), bottom: inch(margin), left: inch(margin), right: inch(margin) },
			generateDocumentOutline: true,
			generateTaggedPDF: true,
			displayHeaderFooter: true,
			headerTemplate: options.header ? label(escapeHtml(title)) : "<span></span>",
			footerTemplate: label('<span class="pageNumber"></span> / <span class="totalPages"></span>'),
		});
		return { data, links };
	} finally {
		activeDocument.title = windowTitle;
		if (themeDark) { body.removeClass("theme-light"); body.addClass("theme-dark"); };
		component.unload();
		root.remove();
	}
}

function waitForQuiet(el: HTMLElement): Promise<void> {
	return new Promise((resolve) => {
		let quiet = window.setTimeout(finish, QUIET_MS);
		const limit = window.setTimeout(finish, MAX_WAIT_MS);
		const observer = new MutationObserver(() => {
			window.clearTimeout(quiet);
			quiet = window.setTimeout(finish, QUIET_MS);
		});
		observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
		function finish(): void {
			observer.disconnect();
			window.clearTimeout(quiet);
			window.clearTimeout(limit);
			resolve();
		}
	});
}
