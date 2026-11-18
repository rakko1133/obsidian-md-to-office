import JSZip from "jszip";
import type { Root } from "mdast";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAPTER_LINK_SCHEME, DocxCombineRun, combineChapters, combinedOutputRef, mocLinks, mocPathOf, orderChapters, type Chapter } from "../src/core/docx-combine";
import { pageDecorations, today } from "../src/core/docx-export";
import { renderDocx, type DiagramAsset } from "../src/core/docx-render";
import type { OutputWriter } from "../src/core/mermaid-export";
import { refKey } from "../src/core/output-plan";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/core/settings";
import type { NoteResult, OutputRef } from "../src/core/types";

// 結合出力（C-8）・表紙（C-8）・目次（C-4a）・ヘッダー・フッター（C-5）

describe("並び順と MOC（C-8）", () => {
	const chapters = [{ notePath: "f/b.md", order: 1 }, { notePath: "f/a.md" }, { notePath: "f/c.md", order: 0 }, { notePath: "f/d.md", order: 1 }];
	it("ファイル名順・order の順（ないものは後ろにファイル名順）・MOC の順（ないものは後ろ）", () => {
		expect(orderChapters(chapters, "fileName").map((c) => c.notePath)).toEqual(["f/a.md", "f/b.md", "f/c.md", "f/d.md"]);
		expect(orderChapters(chapters, "frontmatterOrder").map((c) => c.notePath)).toEqual(["f/c.md", "f/b.md", "f/d.md", "f/a.md"]);
		expect(orderChapters(chapters, "moc", ["f/d.md", "f/a.md"]).map((c) => c.notePath)).toEqual(["f/d.md", "f/a.md", "f/b.md", "f/c.md"]);
	});

	it("MOC のパスとリンクの順（重複・外部 URL・解決できないものは除く）", () => {
		expect(mocPathOf("a/b/note.md", "V")).toBe("a/b/b.md");
		expect(mocPathOf("note.md", "V")).toBe("V.md");
		const md = "- [[c]]\n- [[a#見出し|別名]]\n- ![[b]]\n- [x](d.md)\n- [[c]]\n- [web](https://example.com)\n- [[none]]";
		const resolve = (link: string) => (link === "none" ? null : `f/${link.replace(/\.md$/, "")}.md`);
		expect(mocLinks(md, "f/f.md", resolve)).toEqual(["f/c.md", "f/a.md", "f/b.md", "f/d.md"]);
	});

	it("出力先は 1 フォルダ = 1 つの .docx", () => {
		expect(combinedOutputRef("a/b/note.md", DEFAULT_SETTINGS, "V").path).toBe("_export/a/b/b.docx");
		expect(combinedOutputRef("note.md", DEFAULT_SETTINGS, "V").path).toBe("_export/V.docx");
	});
});

describe("章のまとめ方（C-8）", () => {
	const chapter = (notePath: string, title: string, tree: Root, extra: Partial<Chapter> = {}): Chapter => ({ notePath, title, tree, source: "", comments: [], diagrams: new Map(), ...extra });
	const asset: DiagramAsset = { svg: new Uint8Array(), png: new Uint8Array(), width: 10, height: 10 };
	const first = chapter(
		"f/1.md",
		"一",
		{
			type: "root",
			children: [
				{ type: "heading", depth: 1, children: [{ type: "text", value: "見出し" }], data: { bookmark: "h_1" } },
				{
					type: "paragraph",
					children: [
						{ type: "footnoteReference", identifier: "1", label: "1" },
						{ type: "internalLink", anchor: "h_1", children: [{ type: "text", value: "上へ" }] },
						{ type: "link", url: `${CHAPTER_LINK_SCHEME}f/2.md`, title: null, children: [{ type: "text", value: "二へ" }] },
						{ type: "link", url: `${CHAPTER_LINK_SCHEME}f/none.md`, title: null, children: [{ type: "text", value: "ない章" }] },
						{ type: "commentMark", id: 0 },
					],
				},
				{ type: "footnoteDefinition", identifier: "1", children: [{ type: "paragraph", children: [{ type: "text", value: "脚注一" }] }] },
				{ type: "code", lang: "mermaid", value: "flowchart LR", data: { mermaidIndex: 1 } },
				{ type: "heading", depth: 6, children: [{ type: "text", value: "深い" }] },
			],
		},
		{ comments: ["コメント一"], diagrams: new Map([[1, asset]]) },
	);
	const second = chapter(
		"f/2.md",
		"二",
		{
			type: "root",
			children: [
				{ type: "paragraph", children: [{ type: "footnoteReference", identifier: "1", label: "1" }, { type: "commentMark", id: 0 }] },
				{ type: "footnoteDefinition", identifier: "1", children: [{ type: "paragraph", children: [{ type: "text", value: "脚注二" }] }] },
				{ type: "code", lang: "mermaid", value: "flowchart TD", data: { mermaidIndex: 1 } },
			],
		},
		{ comments: ["コメント二"], diagrams: new Map([[1, asset]]) },
	);
	const { tree, comments, diagrams } = combineChapters([first, second]);
	const json = JSON.stringify(tree);

	it("章の見出し（見出し 1・ブックマーク）、ノートの見出しは 1 段下げ（6 はそのまま）、2 章目の前に改ページ", () => {
		expect(tree.children[0]).toMatchObject({ type: "heading", depth: 1, data: { bookmark: "c1_ch" } });
		expect(tree.children[1]).toMatchObject({ type: "heading", depth: 2, data: { bookmark: "c1_h_1" } });
		expect(tree.children.filter((n) => n.type === "heading" && n.depth === 6)).toHaveLength(1);
		const breakAt = tree.children.findIndex((n) => n.type === "pageBreak");
		expect(tree.children[breakAt + 1]).toMatchObject({ type: "heading", depth: 1, data: { bookmark: "c2_ch" } });
	});

	it("脚注・ブックマーク・コメント・図の連番を章ごとに付け直す", () => {
		expect(json).toContain('"identifier":"c1:1"');
		expect(json).toContain('"identifier":"c2:1"');
		expect(json).toContain('"anchor":"c1_h_1"');
		expect(comments).toEqual(["コメント一", "コメント二"]);
		expect(json).toContain('"type":"commentMark","id":1');
		expect([...diagrams.keys()].sort()).toEqual([1, 3]);
		expect(json).toContain('"mermaidIndex":3');
	});

	it("章へのリンク: 同じ文書の章は章の先頭へ、ない章は文字だけ", () => {
		expect(json).toContain('{"type":"internalLink","anchor":"c2_ch","children":[{"type":"text","value":"二へ"}]}');
		expect(json).not.toContain(CHAPTER_LINK_SCHEME);
		expect(json).toContain('{"type":"text","value":"ない章"}');
	});
});

describe("表紙・目次・ヘッダー・フッター（C-4a・C-5・C-8）", () => {
	const base = {
		title: "文書のタイトル",
		creator: "",
		strictLineBreaks: false,
		fileNameAsTitle: false,
		page: { paperSize: "A4" as const, orientation: "portrait" as const, marginsMm: { top: 25, bottom: 25, left: 25, right: 25 } },
		fonts: { bodyEastAsia: "游明朝", bodyLatin: "Century", headingEastAsia: "游ゴシック", headingLatin: "Arial" },
		diagrams: new Map(),
		source: "",
	};
	const tree: Root = { type: "root", children: [{ type: "heading", depth: 1, children: [{ type: "text", value: "本文" }] }] };
	const files = async (options: Record<string, unknown>) => {
		const zip = await JSZip.loadAsync(await renderDocx(tree, { ...base, ...options }));
		const read = async (pattern: RegExp) => Promise.all(Object.keys(zip.files).filter((n) => pattern.test(n)).sort().map((n) => zip.file(n)!.async("string")));
		return { document: (await read(/word\/document\.xml$/))[0]!, headers: await read(/word\/header\d*\.xml$/), footers: await read(/word\/footer\d*\.xml$/), settings: (await read(/word\/settings\.xml$/))[0]! };
	};

	it("フッターのページ番号（PAGE / NUMPAGES）とヘッダーのタイトル", async () => {
		const f = await files({ footerPageNumber: true, headerTitle: true });
		expect(f.footers.join("")).toMatch(/PAGE[\s\S]*NUMPAGES/);
		expect(f.headers.join("")).toContain("文書のタイトル");
		expect(f.document).not.toContain("<w:titlePg");
	});

	it("付けない設定では、ヘッダーもフッターもない", async () => {
		const f = await files({});
		expect(f.headers).toHaveLength(0);
		expect(f.footers).toHaveLength(0);
	});

	it("表紙: タイトル・作成者・日付と改ページ、表紙のページだけヘッダー・フッターなし（先頭ページのみ別指定）", async () => {
		const f = await files({ footerPageNumber: true, headerTitle: true, cover: { title: "表紙のタイトル", author: "山田 太郎", date: "2026-11-18" } });
		expect(f.document).toMatch(/表紙のタイトル[\s\S]*山田 太郎[\s\S]*2026-11-18[\s\S]*<w:br w:type="page"\/>[\s\S]*本文/);
		expect(f.document).toContain("<w:titlePg/>");
		expect(f.document).toMatch(/<w:headerReference w:type="first"/);
		expect(f.document).toMatch(/<w:footerReference w:type="first"/);
	});

	it("目次: TOC フィールド（見出し 1〜3）と、開いたときに更新する指定", async () => {
		const f = await files({ tableOfContents: "目次" });
		expect(f.document).toContain("目次");
		expect(f.document).toContain('TOC \\h \\o &quot;1-3&quot;');
		expect(f.settings).toContain("<w:updateFields");
	});

	it("設定から表紙・目次の指定を作る", () => {
		const s = (o: Partial<PluginSettings>) => ({ ...DEFAULT_SETTINGS, ...o });
		expect(pageDecorations(s({}), { title: "T", combined: false }, "目次")).toEqual({ footerPageNumber: true, headerTitle: false });
		expect(pageDecorations(s({}), { title: "T", combined: true }, "目次")).toMatchObject({ tableOfContents: "目次" });
		expect(pageDecorations(s({ tableOfContents: "always" }), { title: "T", combined: false }, "目次")).toMatchObject({ tableOfContents: "目次" });
		expect(pageDecorations(s({ tableOfContents: "never" }), { title: "T", combined: true }, "目次").tableOfContents).toBeUndefined();
		expect(pageDecorations(s({ coverPage: true }), { title: "T", author: "A", date: "", combined: false }, "目次").cover).toEqual({ title: "T", author: "A", date: today() });
	});
});

// サンプル（test-vault/combine）を結合出力にする
const VAULT_DIR = "test-vault";
const PNG_1x1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"), (ch) => ch.charCodeAt(0));
function vaultFiles(dir = VAULT_DIR): string[] {
	return readdirSync(dir).flatMap((name) => {
		if (name.startsWith(".")) return [];
		const full = join(dir, name);
		return statSync(full).isDirectory() ? vaultFiles(full) : [relative(VAULT_DIR, full).split("\\").join("/")];
	});
}
const FILES = vaultFiles();
const resolve = (linkpath: string): string | null => FILES.find((f) => f === linkpath || f === `${linkpath}.md` || f.endsWith(`/${linkpath}.md`)) ?? null;
const FRONTMATTER: Record<string, Record<string, unknown>> = {
	"combine/combine.md": { title: "結合出力のサンプル", author: "山田 太郎", date: "2026-11-18" },
	"combine/01-first.md": { order: 2 },
	"combine/02-second.md": { order: 1, title: "二番目（frontmatter のタイトル）" },
};

class MemoryWriter implements OutputWriter {
	readonly files = new Map<string, Uint8Array>();
	async exists(ref: OutputRef) {
		return this.files.has(refKey(ref));
	}
	async write(ref: OutputRef, bytes: Uint8Array) {
		this.files.set(refKey(ref), bytes);
		return { status: "success" as const, contentHash: "h" };
	}
	async hashOf() {
		return null;
	}
	async remove() {
		return true;
	}
}

async function combine(overrides: Partial<PluginSettings>) {
	const notes = FILES.filter((f) => f.startsWith("combine/") && f.endsWith(".md")).sort();
	const writer = new MemoryWriter();
	const run = new DocxCombineRun({ ...DEFAULT_SETTINGS, ...overrides }, notes, { entries: [] }, {
		readNote: async (p) => readFileSync(join(VAULT_DIR, p), "utf8"),
		writer,
		renderer: { version: "test", render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"></svg>', png: PNG_1x1 }) },
		cache: { get: async () => null, put: async () => undefined },
		strictLineBreaks: false,
		tocLabel: "目次",
		vault: { resolveLink: resolve, fileExists: (p) => FILES.includes(p), vaultName: "test-vault", frontmatter: (p) => FRONTMATTER[p] },
	});
	const results: NoteResult[] = [];
	for (const n of notes) results.push(await run.addNote(n, new AbortController().signal));
	await run.finish(results);
	const zip = await JSZip.loadAsync(writer.files.get("vault:_export/combine/combine.docx")!);
	const document = await zip.file("word/document.xml")!.async("string");
	return { writer, results, zip, document };
}

describe("サンプルの結合出力（test-vault/combine）", () => {
	it("1 フォルダ = 1 つの .docx。サブフォルダは別の文書。結果は章のノートに付く", async () => {
		const { writer, results } = await combine({});
		expect([...writer.files.keys()].sort()).toEqual(["vault:_export/combine/combine.docx", "vault:_export/combine/sub/sub.docx"]);
		expect(results.find((r) => r.notePath === "combine/01-first.md")!.files.map((f) => f.output.path)).toEqual(["_export/combine/combine.docx"]);
	});

	it("ファイル名順: MOC も 1 つの章。目次は結合出力では既定で入る。フッターのページ番号", async () => {
		const { document, zip } = await combine({});
		const order = ["01-first", "二番目（frontmatter のタイトル）", "03-third", "結合出力のサンプル"].map((t) => document.indexOf(`>${t}<`));
		expect(order.every((i) => i > 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(document).toContain('TOC \\h \\o &quot;1-3&quot;');
		const footers = await Promise.all(Object.keys(zip.files).filter((n) => /footer\d*\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
		expect(footers.join("")).toContain("NUMPAGES");
	});

	it("order の順", async () => {
		const { document } = await combine({ combineOrder: "frontmatterOrder" });
		const order = ["二番目（frontmatter のタイトル）", "01-first", "03-third"].map((t) => document.indexOf(`>${t}<`));
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	it("MOC の順: MOC は章にせず、表紙とタイトルに使う", async () => {
		const { document, zip } = await combine({ combineOrder: "moc", coverPage: true, headerTitle: true });
		const order = ["03-third", "01-first", "二番目（frontmatter のタイトル）"].map((t) => document.indexOf(`>${t}<`));
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		// 表紙（MOC の title・author・date）
		expect(document).toMatch(/結合出力のサンプル[\s\S]*山田 太郎[\s\S]*2026-11-18/);
		expect(document.match(/>結合出力のサンプル</g)).toHaveLength(1);
		expect(document).toContain("<w:titlePg/>");
		const core = await zip.file("docProps/core.xml")!.async("string");
		expect(core).toContain("<dc:title>結合出力のサンプル</dc:title>");
		expect(core).toContain("<dc:creator>山田 太郎</dc:creator>");
	});

	it("章の間のリンク・章ごとの脚注・図・サブフォルダへの相対リンク", async () => {
		const { document, zip } = await combine({});
		// 2 章目へのリンク: 1 章目の [[02-second]] と [[02-second#節]]（見出しへのリンクも章の先頭へ）、MOC の章の [[02-second]]
		expect(document.match(/<w:hyperlink[^>]*w:anchor="c2_ch"/g)?.length).toBe(3);
		expect(document).toContain('w:name="c2_ch"');
		const footnotes = await zip.file("word/footnotes.xml")!.async("string");
		expect(footnotes).toContain("1 つ目の章の脚注。");
		expect(footnotes).toContain("2 つ目の章の脚注。");
		expect(Object.keys(zip.files).filter((n) => n.startsWith("word/media/")).length).toBeGreaterThanOrEqual(2);
		const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
		expect(rels).toContain('Target="sub/sub.docx"');
		// 変換対象外のノートへのリンクは文字だけ
		expect(rels).not.toContain("01-internal-links");
	});
});
