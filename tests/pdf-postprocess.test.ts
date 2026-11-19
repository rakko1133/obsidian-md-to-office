import { describe, expect, it } from "vitest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { pdfLinkHref, pdfLinkTarget, postprocessPdf } from "../src/core/pdf-postprocess";

/** ページに URI のリンクを 1 つ持つ PDF を作る（printToPDF の出力の代わり）。 */
async function makeBody(pages: number, uri?: string): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
	if (uri) {
		const page = doc.getPage(0);
		const annot = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 100, 20], A: { S: "URI", URI: PDFString.of(uri) } });
		page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
	}
	return doc.save();
}

function firstAction(doc: PDFDocument): PDFDict {
	const annots = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
	return annots.lookup(0, PDFDict).lookup(PDFName.of("A"), PDFDict);
}

describe("PDF の後処理（H1-PDF）", () => {
	it("目印の URL と相対パスを行き来できる（日本語・空白・サブフォルダ）", () => {
		const href = pdfLinkHref("../sub/データ A.pdf");
		expect(pdfLinkTarget(href)).toBe("../sub/データ A.pdf");
		expect(pdfLinkTarget(`${href}#見出し`)).toBe("../sub/データ A.pdf");
		expect(pdfLinkTarget("https://example.com/a.pdf")).toBeNull();
	});

	it("表紙の 1 ページ目を本文の先頭に差し込む", async () => {
		const result = await postprocessPdf(await makeBody(3), { cover: await makeBody(2) });
		expect(result.pages).toBe(4);
	});

	it("目印の URL のリンクを、別の PDF を開くリンク（GoToR）に書き換える", async () => {
		const result = await postprocessPdf(await makeBody(1, pdfLinkHref("データ A.pdf")));
		expect(result.fileLinks).toBe(1);
		const action = firstAction(await PDFDocument.load(result.data));
		expect(action.lookup(PDFName.of("S"))).toBe(PDFName.of("GoToR"));
		expect(action.has(PDFName.of("URI"))).toBe(false);
		const spec = action.lookup(PDFName.of("F"), PDFDict);
		expect(spec.lookup(PDFName.of("UF"), PDFHexString).decodeText()).toBe("データ A.pdf");
	});

	it("ふつうの外部リンクは書き換えない", async () => {
		const result = await postprocessPdf(await makeBody(1, "https://example.com/"));
		expect(result.fileLinks).toBe(0);
		expect(firstAction(await PDFDocument.load(result.data)).lookup(PDFName.of("S"))).toBe(PDFName.of("URI"));
	});

	it("タイトル・作成者・言語・作成ツールを入れる", async () => {
		const result = await postprocessPdf(await makeBody(1), { title: "報告書", author: "山田", lang: "ja" });
		const doc = await PDFDocument.load(result.data, { updateMetadata: false });
		expect(doc.getTitle()).toBe("報告書");
		expect(doc.getAuthor()).toBe("山田");
		expect(doc.getCreator()).toBe("Batch Office Export");
	});
});
