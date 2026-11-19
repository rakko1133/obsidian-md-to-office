// PDF 出力（H1-PDF）の後処理。printToPDF（Chromium）が作った PDF を pdf-lib で書き換える。
// - 表紙: ヘッダー・フッターなしで別に印刷した表紙の PDF の 1 ページ目を、本文の先頭に差し込む
//   （本文のしおり・PDF 内リンクはページの参照で指しているので、差し込んでも崩れない）
// - 別の PDF へのリンク: 印刷の前に目印の URL（PDF_LINK_PREFIX + 相対パス）にしておき、
//   ここで別ファイルへのリンク（GoToR）に書き換える。Chromium は相対パスのリンクを app:// の絶対 URL にしてしまうため
// - 文書プロパティ: タイトル・作成者・作成ツール・言語
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";

/** 別の PDF へのリンクの目印。.invalid はどこにもつながらない予約済みのドメイン */
export const PDF_LINK_PREFIX = "https://batch-office-export.invalid/pdf-link/";

export interface PdfPostprocessOptions {
	/** ヘッダー・フッターなしで印刷した表紙の PDF（1 ページ目だけを使う） */
	cover?: Uint8Array;
	title?: string;
	author?: string;
	/** BCP 47 の言語タグ（例: ja） */
	lang?: string;
	creator?: string;
}

export interface PdfPostprocessResult {
	data: Uint8Array;
	pages: number;
	/** 別の PDF へのリンクに書き換えた数 */
	fileLinks: number;
}

/** 目印の URL から、リンク先の PDF の相対パスを取り出す。目印でなければ null。 */
export function pdfLinkTarget(uri: string): string | null {
	if (!uri.startsWith(PDF_LINK_PREFIX)) return null;
	const rest = uri.slice(PDF_LINK_PREFIX.length).split("#")[0];
	try {
		return decodeURIComponent(rest);
	} catch {
		return null;
	}
}

/** 印刷の前に a 要素の href に入れる目印の URL を作る（相対パスは / 区切り）。 */
export function pdfLinkHref(relativePath: string): string {
	return PDF_LINK_PREFIX + encodeURIComponent(relativePath);
}

export async function postprocessPdf(body: Uint8Array, options: PdfPostprocessOptions = {}): Promise<PdfPostprocessResult> {
	const doc = await PDFDocument.load(body, { updateMetadata: false });
	if (options.cover) {
		const coverDoc = await PDFDocument.load(options.cover);
		const [coverPage] = await doc.copyPages(coverDoc, [0]);
		doc.insertPage(0, coverPage);
	}
	let fileLinks = 0;
	for (const page of doc.getPages()) {
		const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
		if (!annots) continue;
		for (let i = 0; i < annots.size(); i++) {
			const annot = annots.lookupMaybe(i, PDFDict);
			const action = annot?.lookupMaybe(PDFName.of("A"), PDFDict);
			if (!action || action.lookupMaybe(PDFName.of("S"), PDFName) !== PDFName.of("URI")) continue;
			const raw = action.lookup(PDFName.of("URI"));
			const uri = raw instanceof PDFString || raw instanceof PDFHexString ? raw.decodeText() : "";
			const target = pdfLinkTarget(uri);
			if (target === null) continue;
			// GoToR: 別の PDF の 1 ページ目を開く。ファイル名に日本語が入るので、UF（Unicode）も付けたファイル指定にする
			const fileSpec = doc.context.obj({ Type: "Filespec", F: PDFString.of(asciiFallback(target)), UF: PDFHexString.fromText(target) });
			action.set(PDFName.of("S"), PDFName.of("GoToR"));
			action.delete(PDFName.of("URI"));
			action.set(PDFName.of("F"), fileSpec);
			action.set(PDFName.of("D"), doc.context.obj([0, PDFName.of("Fit")]));
			action.set(PDFName.of("NewWindow"), doc.context.obj(false));
			fileLinks++;
		}
	}
	if (options.title !== undefined) doc.setTitle(options.title, { showInWindowTitleBar: true });
	if (options.author) doc.setAuthor(options.author);
	if (options.lang) doc.setLanguage(options.lang);
	doc.setCreator(options.creator ?? "Batch Office Export");
	doc.setModificationDate(new Date());
	const data = await doc.save();
	return { data, pages: doc.getPageCount(), fileLinks };
}

/** F（バイト列のファイル名）用。ASCII 以外は %XX にする（UF を読めない古いビューアー向けの控え）。 */
function asciiFallback(path: string): string {
	return path.replace(/[^\x20-\x7e]/g, (c) => encodeURIComponent(c));
}
