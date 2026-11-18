import JSZip from "jszip";
import { readdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docxOutputRef, exportDocxNote, planDocxNote, svgSize, type DocxExportDeps } from "../src/core/docx-export";
import { bodyArea, fitImage, renderDocx, type DiagramAsset, type DocxRenderOptions } from "../src/core/docx-render";
import { parseMarkdown, transformTree } from "../src/core/markdown";
import { extractMermaidBlocks } from "../src/core/mermaid";
import { refKey } from "../src/core/output-plan";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/core/settings";

// D: テスト用 Vault の word/ のサンプルを .docx にして、word/document.xml をスナップショットで比べる（G5）
const SAMPLE_DIR = join("test-vault", "word");
const PNG_1x1 = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"),
	(ch) => ch.charCodeAt(0),
);
const svgOf = (w: number, h: number) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"></svg>`);

const baseOptions = (source: string, diagrams: Map<number, DiagramAsset>): DocxRenderOptions => ({
	title: "sample",
	creator: "",
	strictLineBreaks: false,
	fileNameAsTitle: false,
	page: { paperSize: "A4", orientation: "portrait", marginsMm: { top: 25, bottom: 25, left: 25, right: 25 } },
	fonts: { bodyEastAsia: "游明朝", bodyLatin: "Century", headingEastAsia: "游ゴシック", headingLatin: "Arial" },
	diagrams,
	source,
});

/** サンプル用の偽の図: 構文の誤った図（"not (((" を含む）は描画に失敗したことにする。大きさは図ごとに変える。 */
function fakeDiagrams(markdown: string): Map<number, DiagramAsset> {
	const map = new Map<number, DiagramAsset>();
	for (const b of extractMermaidBlocks(markdown)) {
		if (b.source.includes("not (((")) continue;
		const lines = b.source.split("\n").length;
		const width = b.source.startsWith("flowchart LR") && lines < 3 ? 1400 : 400;
		map.set(b.index, { svg: svgOf(width, lines * 40), png: PNG_1x1, width, height: lines * 40 });
	}
	return map;
}

async function convert(markdown: string, overrides: Partial<DocxRenderOptions> = {}): Promise<JSZip> {
	const tree = parseMarkdown(markdown);
	transformTree(tree);
	return JSZip.loadAsync(await renderDocx(tree, { ...baseOptions(markdown, fakeDiagrams(markdown)), ...overrides }));
}

const xml = async (zip: JSZip, path: string) => (await zip.file(path)?.async("string")) ?? "";

/** スナップショット用: docx ライブラリが毎回変える値（ハイパーリンクのランダムな関係 ID、通し番号の docPr の ID）をそろえる。 */
const stable = (s: string) => s.replace(/r:id="rId[A-Za-z0-9_-]{10,}"/g, 'r:id="rIdLINK"').replace(/<wp:docPr id="\d+"/g, '<wp:docPr id="N"');

describe("サンプルの word/document.xml（スナップショット）", () => {
	for (const file of readdirSync(SAMPLE_DIR).filter((f) => f.endsWith(".md")).sort()) {
		it(file, async () => {
			const zip = await convert(readFileSync(join(SAMPLE_DIR, file), "utf8"));
			expect(stable(await xml(zip, "word/document.xml"))).toMatchSnapshot();
		});
	}

	it("同じ入力からは同じ document.xml ができる（スナップショットが安定する）", async () => {
		const md = readFileSync(join(SAMPLE_DIR, "11-all-in-one.md"), "utf8");
		expect(stable(await xml(await convert(md), "word/document.xml"))).toBe(stable(await xml(await convert(md), "word/document.xml")));
	});
});

describe("要素の変換", () => {
	it("見出しは組み込みの見出しスタイル（A-1）", async () => {
		const doc = await xml(await convert("# A\n\n###### F"), "word/document.xml");
		expect(doc).toContain('<w:pStyle w:val="Heading1"/>');
		expect(doc).toContain('<w:pStyle w:val="Heading6"/>');
	});

	it("ファイル名を表題にするときは見出しを 1 段下げる", async () => {
		const doc = await xml(await convert("# A", { fileNameAsTitle: true, title: "ノート" }), "word/document.xml");
		expect(doc).toContain('<w:pStyle w:val="Title"/>');
		expect(doc).toContain('<w:pStyle w:val="Heading2"/>');
	});

	it("単一改行は、厳密な改行がオフなら w:br、オンなら空白（A-2）", async () => {
		const off = await xml(await convert("a\nb", { strictLineBreaks: false }), "word/document.xml");
		const on = await xml(await convert("a\nb", { strictLineBreaks: true }), "word/document.xml");
		expect(off).toContain("<w:br/>");
		expect(on).not.toContain("<w:br/>");
		expect(on).toContain("a b");
	});

	it("番号付きリストはリストごとに振り直し、開始番号を反映する（A-3）", async () => {
		const zip = await convert("1. a\n2. b\n\ntext\n\n1. c\n\ntext\n\n3. d");
		const numbering = await xml(zip, "word/numbering.xml");
		expect(numbering).toContain('<w:start w:val="3"/>');
		const numIds = [...(await xml(zip, "word/document.xml")).matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
		expect(new Set(numIds).size).toBe(3);
	});

	it("タスクの記号と独自の状態（A-4）", async () => {
		const doc = await xml(await convert("- [ ] a\n- [x] b\n- [/] c\n- [?] d"), "word/document.xml");
		for (const s of ["☐ ", "☑ ", "◐ "]) expect(doc).toContain(s);
		expect(doc).toContain("[?] d");
	});

	it("表は見出し行を繰り返し、配置を反映する（A-9）", async () => {
		const doc = await xml(await convert("| a | b |\n|:-:|--:|\n| 1 | 2 |"), "word/document.xml");
		expect(doc).toContain("<w:tblHeader/>");
		expect(doc).toContain('<w:jc w:val="center"/>');
		expect(doc).toContain('<w:jc w:val="right"/>');
	});

	it("文字書式（A-13）", async () => {
		const doc = await xml(await convert("**b** *i* ~~s~~ ==h== `c`"), "word/document.xml");
		for (const tag of ["<w:b/>", "<w:i/>", "<w:strike/>", '<w:highlight w:val="yellow"/>', 'w:ascii="Consolas"']) expect(doc).toContain(tag);
	});

	it("外部リンクはハイパーリンク、内部リンクは文字だけ（A-17）", async () => {
		const zip = await convert("[x](https://obsidian.md) [y](note.md)");
		expect(await xml(zip, "word/_rels/document.xml.rels")).toContain('Target="https://obsidian.md"');
		const doc = await xml(zip, "word/document.xml");
		expect(doc.match(/<w:hyperlink /g)).toHaveLength(1);
		expect(doc).toContain(">y<");
	});

	it("Mermaid は SVG と PNG フォールバックで埋め込む（A-12）", async () => {
		const zip = await convert("```mermaid\nflowchart TD\n  A-->B\n```");
		const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/"));
		expect(media.some((f) => f.endsWith(".svg"))).toBe(true);
		expect(media.some((f) => f.endsWith(".png"))).toBe(true);
	});

	it("描画できなかった Mermaid はソースのコードブロックとして残す（R4）", async () => {
		const doc = await xml(await convert("```mermaid\nflowchart TD\n  not ((( x\n```"), "word/document.xml");
		expect(doc).toContain('<w:pStyle w:val="SourceCode"/>');
		expect(doc).toContain("not ((( x");
	});

	it("未対応の記法は元の Markdown を等幅で残し、種類ごとに警告する（A-0b）", async () => {
		const md = "![alt](a.png)\n\n<div>x</div>\n\n![b](b.png)";
		const tree = parseMarkdown(md);
		const ctx = transformTree(tree);
		expect(ctx.warnings.map((w) => w.detail).sort()).toEqual(["html", "image"]);
		const doc = await xml(await JSZip.loadAsync(await renderDocx(tree, baseOptions(md, new Map()))), "word/document.xml");
		expect(doc).toContain("![alt](a.png)");
		expect(doc).toContain("&lt;div&gt;x&lt;/div&gt;");
	});

	it("frontmatter は本文に出さない", async () => {
		const doc = await xml(await convert("---\ntitle: T\n---\n本文"), "word/document.xml");
		expect(doc).not.toContain("title: T");
	});
});

describe("文書の体裁とプロパティ（C-2・C-3・R3）", () => {
	it("A4・余白 25 mm・既定のフォント", async () => {
		const zip = await convert("x");
		const doc = await xml(zip, "word/document.xml");
		// 210 × 297 mm を twip に換算（端数は切り捨て）
		expect(doc).toMatch(/<w:pgSz w:w="1190[56]" w:h="1683[78]" w:orient="portrait"/);
		expect(doc).toMatch(/w:top="1417"/);
		const styles = await xml(zip, "word/styles.xml");
		expect(styles).toContain('w:eastAsia="游明朝"');
		expect(styles).toContain('w:eastAsia="游ゴシック"');
	});

	it("作成者は空または設定の値で、OS のユーザー名が入らない", async () => {
		const core = await xml(await convert("x"), "docProps/core.xml");
		expect(core).toContain("<dc:title>sample</dc:title>");
		expect(core).not.toContain(userInfo().username);
		expect(core).not.toMatch(/<dc:creator>[^<]+<\/dc:creator>/);
		const named = await xml(await convert("x", { creator: "山田" }), "docProps/core.xml");
		expect(named).toContain("<dc:creator>山田</dc:creator>");
	});

	it("画像は本文の領域に収め、縦横比を保ち、拡大しない（R4）", () => {
		const area = bodyArea({ paperSize: "A4", orientation: "portrait", marginsMm: { top: 25, bottom: 25, left: 25, right: 25 } });
		expect(Math.round(area.width)).toBe(605);
		expect(fitImage(100, 50, area)).toEqual({ width: 100, height: 50 });
		expect(fitImage(1210, 100, area)).toEqual({ width: 605, height: 50 });
		const tall = fitImage(400, 4000, area);
		expect(tall.height).toBe(Math.round(area.height));
	});

	it("SVG の width / height を読む", () => {
		expect(svgSize('<svg xmlns="x" width="320" height="200" viewBox="0 0 320 200">')).toEqual({ width: 320, height: 200 });
		expect(svgSize("<svg>")).toEqual({ width: 800, height: 600 });
	});
});

describe("exportDocxNote", () => {
	const settings: PluginSettings = { ...DEFAULT_SETTINGS };
	const NOTE = "# t\n\n```mermaid\nflowchart TD\n  A-->B\n```\n";

	function fakeDeps(files = new Map<string, Uint8Array>()) {
		const log = { renders: 0 };
		const cache = new Map<string, Uint8Array>();
		const deps: DocxExportDeps = {
			strictLineBreaks: undefined,
			readNote: async () => NOTE,
			renderer: {
				version: "11",
				render: async () => {
					log.renders++;
					return { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>', png: PNG_1x1 };
				},
			},
			cache: { get: async (h, e) => cache.get(`${h}.${e}`) ?? null, put: async (h, e, b) => void cache.set(`${h}.${e}`, b) },
			writer: {
				exists: async (ref) => files.has(refKey(ref)),
				write: async (ref, bytes) => {
					files.set(refKey(ref), bytes);
					return { status: "success", contentHash: "h" };
				},
				hashOf: async () => "h",
				remove: async () => true,
			},
		};
		return { deps, files, log };
	}
	const signal = () => new AbortController().signal;

	it("ミラー出力のフォルダに {ノート名}.docx を書く。画像ファイルは既定では出さない", async () => {
		const { deps, files } = fakeDeps();
		const r = await exportDocxNote("notes/a.md", signal(), settings, { entries: [] }, deps);
		expect(r.status).toBe("success");
		expect([...files.keys()]).toEqual(["vault:_export/notes/a.docx"]);
	});

	it("saveImageFiles なら Mermaid の画像ファイルも保存し、描画は 1 回で済む（キャッシュ）", async () => {
		const { deps, files, log } = fakeDeps();
		const r = await exportDocxNote("a.md", signal(), { ...settings, saveImageFiles: true }, { entries: [] }, deps);
		expect(r.files.map((f) => f.kind).sort()).toEqual(["docx", "image"]);
		expect(files.size).toBe(2);
		expect(log.renders).toBe(1);
	});

	it("同名ファイルがあるとき: スキップ / 連番", async () => {
		const existing = () => new Map([["vault:_export/a.docx", new Uint8Array()]]);
		const skip = await exportDocxNote("a.md", signal(), { ...settings, onConflict: "skip" }, { entries: [] }, fakeDeps(existing()).deps);
		expect(skip.files[0]).toMatchObject({ status: "skipped", reason: "exists" });
		const renamed = await exportDocxNote("a.md", signal(), { ...settings, onConflict: "rename" }, { entries: [] }, fakeDeps(existing()).deps);
		expect(renamed.files[0]!.output.path).toBe("_export/a (1).docx");
	});

	it("ドライランは出力パスと予定動作を返す", async () => {
		expect(docxOutputRef("x/y.md", settings)).toEqual({ location: "vault", path: "_export/x/y.docx" });
		const plans = await planDocxNote("x/y.md", settings, async () => true);
		expect(plans).toEqual([{ output: { location: "vault", path: "_export/x/y.docx" }, action: "overwrite" }]);
	});
});
