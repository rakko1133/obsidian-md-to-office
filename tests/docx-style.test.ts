import { strToU8, zipSync } from "fflate";
import JSZip from "jszip";
import type { Root } from "mdast";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { styleOptions } from "../src/core/docx-export";
import { mermaidTitle, renderDocx, type DocxRenderOptions } from "../src/core/docx-render";
import { normalizeStyleIds, readTemplate, styleIds } from "../src/core/docx-template";
import { DEFAULT_SETTINGS } from "../src/core/settings";

// Word の体裁（フェーズ 5b）: 見出しのスタイル（C-1a）・テンプレート（C-1b）・段落番号（C-1c）・改ページ（C-2）・表の幅（C-6）・図表番号（R4・C-4b）

const PNG_1x1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"), (ch) => ch.charCodeAt(0));
const base: DocxRenderOptions = {
	title: "t",
	creator: "",
	strictLineBreaks: false,
	fileNameAsTitle: false,
	page: { paperSize: "A4", orientation: "portrait", marginsMm: { top: 25, bottom: 25, left: 25, right: 25 } },
	fonts: { bodyEastAsia: "游明朝", bodyLatin: "Century", headingEastAsia: "游ゴシック", headingLatin: "Arial" },
	diagrams: new Map([[1, { svg: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), png: PNG_1x1, width: 10, height: 10 }]]),
	source: "",
};

const text = (value: string) => ({ type: "text" as const, value });
const tree: Root = {
	type: "root",
	children: [
		{ type: "heading", depth: 1, children: [text("最初")] },
		{ type: "heading", depth: 2, children: [text("図の節")] },
		{ type: "code", lang: "mermaid", value: "---\ntitle: 変換の流れ\n---\nflowchart LR", data: { mermaidIndex: 1 } },
		{ type: "code", lang: "mermaid", value: "flowchart TD", data: { mermaidIndex: 1 } },
		{ type: "paragraph", children: [{ type: "embedImage", path: "a/sample.png", alt: "図のサンプル", data: { image: { type: "png", data: PNG_1x1, width: 10, height: 10 } } }] },
		{ type: "paragraph", children: [{ type: "embedImage", path: "a/sample.png", alt: "sample.png", data: { image: { type: "png", data: PNG_1x1, width: 10, height: 10 } } }] },
		{ type: "paragraph", children: [text("文の中の "), { type: "embedImage", path: "a/sample.png", alt: "文中", data: { image: { type: "png", data: PNG_1x1, width: 10, height: 10 } } }] },
		{ type: "heading", depth: 1, children: [text("二つ目")] },
		{ type: "heading", depth: 2, children: [text("売上の表")] },
		{
			type: "table",
			align: [null],
			children: [
				{ type: "tableRow", children: [{ type: "tableCell", children: [text("店舗")] }] },
				{ type: "tableRow", children: [{ type: "tableCell", children: [text("札幌")] }] },
			],
		},
		{ type: "pageBreak" },
		{ type: "heading", depth: 1, children: [text("改ページの後")] },
	],
};

async function render(options: Partial<DocxRenderOptions>) {
	const zip = await JSZip.loadAsync(await renderDocx(structuredClone(tree), { ...base, ...options }));
	const read = (name: string) => zip.file(name)?.async("string") ?? Promise.resolve("");
	return { document: await read("word/document.xml"), styles: await read("word/styles.xml"), numbering: await read("word/numbering.xml") };
}

/** 段落の XML（w:p）を、中の文字で探す。 */
const paragraphWith = (xml: string, text: string) => xml.split("<w:p>").concat(xml.split("<w:p ")).find((p) => p.includes(`>${text}<`)) ?? "";

describe("見出しのスタイル（C-1a）", () => {
	it("見出し 1〜6 と表題に大きさ・太字・間隔・次の段落と同じページ", async () => {
		const { styles } = await render({});
		const style = (id: string) => styles.match(new RegExp(`<w:style [^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`))?.[0] ?? "";
		expect(style("Heading1")).toContain('<w:sz w:val="32"/>');
		expect(style("Heading1")).toContain("<w:b/>");
		expect(style("Heading1")).toContain("<w:keepNext/>");
		expect(style("Heading2")).toContain('<w:sz w:val="28"/>');
		expect(style("Heading3")).toContain('<w:sz w:val="24"/>');
		expect(style("Heading6")).toContain('<w:sz w:val="22"/>');
		expect(style("Title")).toContain('<w:sz w:val="48"/>');
		expect(style("Caption")).toContain("caption");
	});
});

describe("テンプレート（C-1b）", () => {
	const templateStyles = [
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
		'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
		'<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>',
		'<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:next w:val="a"/><w:link w:val="10"/><w:rPr><w:color w:val="FF0000"/></w:rPr></w:style>',
		'<w:style w:type="character" w:customStyle="1" w:styleId="10"><w:name w:val="見出し 1 (文字)"/><w:link w:val="1"/></w:style>',
		'<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/></w:rPr></w:style>',
		"</w:styles>",
	].join("");

	it("日本語版 Word の ID（見出し 1 なら \"1\"）を、名前から Heading1 などに付け直す（参照も合わせる）", () => {
		const xml = normalizeStyleIds(templateStyles);
		expect(xml).toContain('w:styleId="Heading1"');
		expect(xml).not.toContain('w:styleId="1"');
		expect(xml).toContain('<w:link w:val="Heading1"/>');
		expect(styleIds(xml)).toEqual(new Set(["a", "Heading1", "10", "Quote"]));
	});

	it(".dotx から styles.xml を読む。styles.xml がなければ例外", () => {
		const bytes = zipSync({ "word/styles.xml": strToU8(templateStyles), "[Content_Types].xml": strToU8("<Types/>") });
		expect(readTemplate(bytes).styles).toContain('w:styleId="Heading1"');
		expect(() => readTemplate(zipSync({ "a.txt": strToU8("x") }))).toThrow("word/styles.xml");
	});

	it("テスト用 Vault のテンプレート（Word で作った .dotx）を読める", () => {
		const template = readTemplate(new Uint8Array(readFileSync("test-vault/style/templates/red-headings.dotx")));
		expect(styleIds(template.styles).has("Heading1")).toBe(true);
		expect(template.styles).toMatch(/w:styleId="Heading1"[\s\S]*?<w:color w:val="FF0000"/);
	});

	it("テンプレートのスタイルを使い、ないスタイル（コード・図表番号）だけ内蔵のものを補う", async () => {
		const template = { styles: normalizeStyleIds(templateStyles) };
		const { styles } = await render({ template, captions: { figure: "図" } });
		const heading1 = styles.match(/<w:style [^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/g) ?? [];
		expect(heading1).toHaveLength(1);
		expect(heading1[0]).toContain('w:val="FF0000"');
		expect(heading1[0]).not.toContain('<w:sz w:val="32"/>');
		// テンプレートにある引用文はテンプレートのもの、ないコードと図表番号は内蔵のもの
		expect(styles.match(/w:styleId="Quote"/g)).toHaveLength(1);
		expect(styles).toMatch(/w:styleId="Quote"[\s\S]*?<w:i\/>/);
		expect(styles).toContain('w:styleId="SourceCode"');
		expect(styles).toContain('w:styleId="Caption"');
	});
});

describe("段落番号・改ページ・表の幅（C-1c・C-2・C-6）", () => {
	it("見出しの段落番号: 1 / 1.1 / 1.1.1 …、見出しの段落が番号を参照する", async () => {
		const { document, numbering } = await render({ headingNumbering: true });
		expect(numbering).toContain('<w:lvlText w:val="%1"/>');
		expect(numbering).toContain('<w:lvlText w:val="%1.%2"/>');
		expect(numbering).toContain('<w:lvlText w:val="%1.%2.%3"/>');
		expect(numbering).toContain('<w:suff w:val="space"/>');
		expect(paragraphWith(document, "図の節")).toMatch(/<w:numPr><w:ilvl w:val="1"\/>/);
	});

	it("見出しの番号の定義には開始番号の上書きを付けない（付けると Word の PDF で 2 つ目の見出し 1 が「1」になる）。番号付きリストには残す", async () => {
		const withList = structuredClone(tree);
		withList.children.push({ type: "list", ordered: true, start: 3, spread: false, children: [{ type: "listItem", spread: false, children: [{ type: "paragraph", children: [text("項目")] }] }] });
		const zip = await JSZip.loadAsync(await renderDocx(withList, { ...base, headingNumbering: true }));
		const numbering = await zip.file("word/numbering.xml")!.async("string");
		const abstract = [...numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)];
		const headingId = abstract.find((m) => m[2]!.includes('<w:lvlText w:val="%1.%2"/>'))![1]!;
		const listId = abstract.find((m) => m[2]!.includes('<w:start w:val="3"/>'))![1]!;
		const num = (abstractId: string) => [...numbering.matchAll(/<w:num\b[^>]*>([\s\S]*?)<\/w:num>/g)].map((m) => m[0]).filter((n) => n.includes(`<w:abstractNumId w:val="${abstractId}"/>`));
		expect(num(headingId).length).toBeGreaterThan(0);
		for (const n of num(headingId)) expect(n).not.toContain("w:lvlOverride");
		expect(num(listId).some((n) => n.includes("w:startOverride"))).toBe(true);
	});

	it("見出し 1 の前で改ページ: 最初の見出し 1 と、改ページの直後の見出し 1 には付けない", async () => {
		const { document } = await render({ pageBreakBeforeH1: true });
		expect(paragraphWith(document, "最初")).not.toContain("<w:pageBreakBefore/>");
		expect(paragraphWith(document, "二つ目")).toContain("<w:pageBreakBefore/>");
		expect(paragraphWith(document, "改ページの後")).not.toContain("<w:pageBreakBefore/>");
		expect(paragraphWith(document, "図の節")).not.toContain("<w:pageBreakBefore/>");
	});

	it("表の幅: 既定は内容に合わせ、設定で 100%", async () => {
		expect((await render({})).document).toContain('<w:tblW w:type="auto" w:w="0"/>');
		expect((await render({ tableFullWidth: true })).document).toContain('<w:tblW w:type="pct" w:w="100%"/>');
	});

	it("付けない設定では、番号も改ページもない", async () => {
		const { document } = await render({});
		expect(document).not.toContain("<w:numPr>");
		expect(document).not.toContain("<w:pageBreakBefore/>");
	});
});

describe("図表番号（R4・C-4b）", () => {
	it("図: Mermaid の title、画像の代替テキスト、なければ直前の見出し。番号は SEQ フィールド", async () => {
		const { document } = await render({ captions: { figure: "図", table: "表" } });
		const captions = [...document.matchAll(/<w:p><w:pPr><w:pStyle w:val="Caption"\/>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
		const plain = captions.map((c) => [...c.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)].map((m) => m[1] ?? `{${m[2]!.trim()}}`).join(""));
		expect(plain).toEqual([
			"図 {SEQ 図}: 変換の流れ",
			"図 {SEQ 図}: 図の節",
			"図 {SEQ 図}: 図のサンプル",
			// 代替テキストがファイル名と同じなら、直前の見出し
			"図 {SEQ 図}: 図の節",
			// 表は上に、直前の見出し
			"表 {SEQ 表}: 売上の表",
		]);
		// 文の中の画像には付けない（画像だけの段落だけ）
		expect(captions.join("")).not.toContain("文中");
		// 表番号は表の前
		expect(document.indexOf("売上の表</w:t></w:r></w:p><w:tbl>") > 0 || /売上の表<\/w:t><\/w:r><\/w:p>\s*<w:tbl>/.test(document)).toBe(true);
	});

	it("付けない設定では図表番号なし", async () => {
		expect((await render({})).document).not.toContain('w:val="Caption"');
	});

	it("Mermaid の frontmatter の title", () => {
		expect(mermaidTitle("---\ntitle: 流れ\n---\nflowchart LR")).toBe("流れ");
		expect(mermaidTitle('---\ntitle: "引用符"\nconfig: {}\n---\nx')).toBe("引用符");
		expect(mermaidTitle("flowchart LR")).toBeUndefined();
	});

	it("設定から体裁の指定を作る（図表番号は設定ごとに）", () => {
		const labels = { figure: "図", table: "表" };
		expect(styleOptions(DEFAULT_SETTINGS, { captionLabels: labels })).toEqual({ headingNumbering: false, pageBreakBeforeH1: false, tableFullWidth: false });
		expect(styleOptions({ ...DEFAULT_SETTINGS, figureCaptions: true }, { captionLabels: labels }).captions).toEqual({ figure: "図" });
		expect(styleOptions({ ...DEFAULT_SETTINGS, tableCaptions: true }, { captionLabels: labels }).captions).toEqual({ table: "表" });
	});
});
