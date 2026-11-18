import JSZip from "jszip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { convertedNotes, docxOutputRef, exportDocxNote, mermaidBlocksOf, planDocxNote, svgSize, type DocxExportDeps, type VaultEnvironment } from "../src/core/docx-export";
import { bodyArea, calloutColor, fitImage, imageSize, lightColor, renderDocx, tokenColor, type DiagramAsset, type DocxRenderOptions } from "../src/core/docx-render";
import { assembleNote, type NoteEnvironment } from "../src/core/note-assembly";
import type { CodeToken } from "../src/core/obsidian-syntax";
import { refKey, relativeUrl } from "../src/core/output-plan";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/core/settings";
import type { Warning } from "../src/core/types";

// D: テスト用 Vault の word/ と word3a/ のサンプルを .docx にして、word/document.xml をスナップショットで比べる（G5）
const VAULT_DIR = "test-vault";
const SAMPLE_DIRS = ["word", "word3a", "word3b"];
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
function fakeDiagrams(blocks: { index: number; source: string }[]): Map<number, DiagramAsset> {
	const map = new Map<number, DiagramAsset>();
	for (const b of blocks) {
		if (b.source.includes("not (((")) continue;
		const lines = b.source.split("\n").length;
		const width = b.source.startsWith("flowchart LR") && lines < 3 ? 1400 : 400;
		map.set(b.index, { svg: svgOf(width, lines * 40), png: PNG_1x1, width, height: lines * 40 });
	}
	return map;
}

/** テスト用 Vault のファイルの一覧（Vault からの相対パス）。 */
function vaultFiles(dir = VAULT_DIR): string[] {
	return readdirSync(dir).flatMap((name) => {
		if (name.startsWith(".")) return [];
		const full = join(dir, name);
		return statSync(full).isDirectory() ? vaultFiles(full) : [relative(VAULT_DIR, full).split("\\").join("/")];
	});
}
const FILES = vaultFiles();

/** getFirstLinkpathDest の簡易版: パスの一致、拡張子 .md を補った一致、ファイル名の一致（同じフォルダを優先）。 */
function fakeResolve(linkpath: string, source: string): string | null {
	const exact = FILES.find((f) => f === linkpath || f === `${linkpath}.md`);
	if (exact) return exact;
	const name = linkpath.slice(linkpath.lastIndexOf("/") + 1);
	const matches = FILES.filter((f) => {
		const base = f.slice(f.lastIndexOf("/") + 1);
		return base === name || base === `${name}.md`;
	});
	const dir = source.slice(0, source.lastIndexOf("/") + 1);
	return matches.find((f) => f.startsWith(dir)) ?? matches[0] ?? null;
}

const KEYWORDS = new Set(["const", "let", "function", "return", "def", "if", "else", "true", "false"]);

/** 偽の色付け: キーワード・文字列・コメントだけを見分ける。 */
function fakeHighlight(code: string, lang: string): CodeToken[] | null {
	if (!["ts", "js", "python", "json", "bash"].includes(lang)) return null;
	const tokens: CodeToken[] = [];
	for (const m of code.matchAll(/(\/\/[^\n]*)|("[^"\n]*")|([A-Za-z_]+)|([^A-Za-z_"/]+|\/)/g)) {
		if (m[1]) tokens.push({ text: m[1], types: ["comment"] });
		else if (m[2]) tokens.push({ text: m[2], types: ["string"] });
		else if (m[3]) tokens.push({ text: m[3], types: KEYWORDS.has(m[3]) ? ["keyword"] : [] });
		else tokens.push({ text: m[0], types: [] });
	}
	return tokens;
}

const fakeVault: VaultEnvironment = {
	resolveLink: fakeResolve,
	fileExists: (path) => FILES.includes(path),
	vaultName: "test-vault",
	loadImage: async (path) => {
		const ext = path.slice(path.lastIndexOf(".") + 1);
		if (ext === "svg") return { type: "svg", data: svgOf(240, 160), fallback: PNG_1x1, width: 240, height: 160 };
		const large = path.includes("large");
		return { type: ext === "jpg" ? "jpg" : "png", data: PNG_1x1, width: large ? 1600 : 640, height: large ? 900 : 400 };
	},
	highlight: fakeHighlight,
	// フェーズ 3b: Dataview とテスト用の処理だけを「描画できる」とし、決まった結果を返す。dataviewjs は時間切れにする
	renderableLanguage: (lang) => ["dataview", "dataviewjs", "boe-test-svg", "boe-test-canvas"].includes(lang),
	renderBlock: async (lang, source) => {
		if (lang === "dataviewjs") throw new Error("timeout (10 s)");
		if (lang.startsWith("boe-test")) return [{ type: "paragraph", children: [{ type: "embedImage", path: "", alt: lang, data: { image: { type: "png", data: PNG_1x1, width: 300, height: 100 } } }] }];
		if (source.trim().startsWith("TABLE")) {
			return [
				{
					type: "table",
					align: [null, null],
					children: [
						{ type: "tableRow", children: [{ type: "tableCell", children: [{ type: "text", value: "File" }] }, { type: "tableCell", children: [{ type: "text", value: "status" }] }] },
						{ type: "tableRow", children: [{ type: "tableCell", children: [{ type: "wikiLink", target: "data/データ A.md", subpath: "", embed: false, raw: "", children: [{ type: "text", value: "データ A" }] }] }, { type: "tableCell", children: [{ type: "text", value: "draft" }] }] },
					],
				},
			];
		}
		return [{ type: "list", ordered: false, spread: false, children: [{ type: "listItem", spread: false, checked: source.includes("TASK") ? false : null, children: [{ type: "paragraph", children: [{ type: "text", value: "項目" }] }] }] }];
	},
	renderMath: async (latex) => {
		if (latex.includes("undefinedcommand")) throw new Error("MathJax could not read the formula");
		return { type: "svg", data: svgOf(80, 20), fallback: PNG_1x1, width: 80, height: 20 };
	},
	fetchImage: async (url) => {
		if (url.includes("no-such")) throw new Error("HTTP 404");
		return { type: "png", data: PNG_1x1, width: 200, height: 100 };
	},
	frontmatter: (path) =>
		path.endsWith("08-frontmatter.md") ? { title: "frontmatter のタイトル", author: "山田 太郎", tags: ["sample", "phase3a"], created: "2026-11-18T09:30:00Z", status: "draft" } : undefined,
};

interface Converted {
	zip: JSZip;
	warnings: Warning[];
}

/** ノートを組み立てて .docx にする。path を指定しないときは、Vault に存在しないノート test.md として変換する。 */
async function convertNote(
	markdown: string,
	overrides: Partial<DocxRenderOptions> = {},
	path = "test.md",
	options: { keepComments: boolean; downloadExternalImages?: boolean } = { keepComments: false },
	extra: Partial<NoteEnvironment> = {},
): Promise<Converted> {
	const folder = path.slice(0, path.lastIndexOf("/") + 1);
	const env: NoteEnvironment = {
		...fakeVault,
		readNote: async (p) => (p === path ? markdown : readFileSync(join(VAULT_DIR, p), "utf8")),
		// 同じフォルダ（とその下）のノートを変換対象とみなす
		isConverted: (p) => folder !== "" && p.startsWith(folder),
		docxLink: (target) => relativeUrl(docxOutputRef(path, DEFAULT_SETTINGS), docxOutputRef(target, DEFAULT_SETTINGS)),
		...extra,
	};
	const assembled = await assembleNote(path, env, options);
	const zip = await JSZip.loadAsync(
		await renderDocx(assembled.tree, { ...baseOptions(assembled.source, fakeDiagrams(mermaidBlocksOf(assembled.tree))), comments: assembled.comments, ...overrides }),
	);
	return { zip, warnings: assembled.warnings };
}

async function convert(markdown: string, overrides: Partial<DocxRenderOptions> = {}): Promise<JSZip> {
	return (await convertNote(markdown, overrides)).zip;
}

const xml = async (zip: JSZip, path: string) => (await zip.file(path)?.async("string")) ?? "";

/** スナップショット用: docx ライブラリが毎回変える値（ハイパーリンクのランダムな関係 ID、通し番号の docPr の ID）をそろえる。 */
const stable = (s: string) => s.replace(/r:id="rId[A-Za-z0-9_-]{10,}"/g, 'r:id="rIdLINK"').replace(/<wp:docPr id="\d+"/g, '<wp:docPr id="N"');

describe("サンプルの word/document.xml（スナップショット）", () => {
	for (const dir of SAMPLE_DIRS) {
		for (const file of readdirSync(join(VAULT_DIR, dir)).filter((f) => f.endsWith(".md")).sort()) {
			const path = `${dir}/${file}`;
			// word/ のサンプルのテスト名は変えない（フェーズ 2 のスナップショットの名前を保つ）
			it(dir === "word" ? file : path, async () => {
				const { zip, warnings } = await convertNote(readFileSync(join(VAULT_DIR, path), "utf8"), {}, path);
				expect(stable(await xml(zip, "word/document.xml"))).toMatchSnapshot();
				if (dir !== "word") expect(warnings.map((w) => `${w.code}: ${w.detail ?? ""}`)).toMatchSnapshot();
			});
		}
	}

	it("同じ入力からは同じ document.xml ができる（スナップショットが安定する）", async () => {
		const path = "word3a/11-all-in-one.md";
		const md = readFileSync(join(VAULT_DIR, path), "utf8");
		const once = async () => stable(await xml((await convertNote(md, {}, path)).zip, "word/document.xml"));
		expect(await once()).toBe(await once());
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

	it("外部リンクはハイパーリンク、解決できない内部リンクは文字だけ（A-17・A-18）", async () => {
		const { zip, warnings } = await convertNote("[x](https://obsidian.md) [y](note.md)");
		expect(await xml(zip, "word/_rels/document.xml.rels")).toContain('Target="https://obsidian.md"');
		const doc = await xml(zip, "word/document.xml");
		expect(doc.match(/<w:hyperlink /g)).toHaveLength(1);
		expect(doc).toContain(">y<");
		expect(warnings).toEqual([{ code: "brokenLink", detail: "[y](note.md)" }]);
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

	it("HTML のブロックはタグを除いて文字だけ残す（A-14）", async () => {
		const { zip, warnings } = await convertNote("<div>x &amp; y</div>\n\n<!-- c -->");
		const doc = await xml(zip, "word/document.xml");
		expect(doc).toContain(">x &amp; y<");
		expect(doc).not.toContain("div");
		expect(warnings).toEqual([]);
	});

	it("参照形式のリンクは定義の URL のハイパーリンク", async () => {
		const zip = await convert("[x][r]\n\n[r]: https://example.com");
		expect(await xml(zip, "word/_rels/document.xml.rels")).toContain('Target="https://example.com"');
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

describe("フェーズ 3a の要素", () => {
	const doc = async (zip: JSZip) => xml(zip, "word/document.xml");

	it("変換対象のノートへのリンクは出力した .docx への相対リンク、対象外は文字だけ（A-18）", async () => {
		const { zip, warnings } = await convertNote("[[02-embed-notes|埋め込み]] [[01-headings]] [[parts/embed-source]]", {}, "word3a/x.md");
		const rels = await xml(zip, "word/_rels/document.xml.rels");
		expect(rels).toContain('Target="02-embed-notes.docx"');
		expect(rels).toContain('Target="parts/embed-source.docx"');
		expect(rels).not.toContain("01-headings");
		expect(await doc(zip)).toContain(">01-headings<");
		expect(warnings).toEqual([]);
	});

	it("同じノートの見出し・ブロックへのリンクはブックマークへのリンク（A-19）", async () => {
		const zip = await convert("[[#節 B]] [[#^p1]]\n\n## 節 A\n\n## 節 B\n\n段落 ^p1");
		const d = await doc(zip);
		expect(d).toMatch(/<w:hyperlink [^>]*w:anchor="h_1"/);
		expect(d).toContain('w:name="h_1"');
		expect(d).toMatch(/<w:hyperlink [^>]*w:anchor="b_p1"/);
		expect(d).toContain('w:name="b_p1"');
		// リンクされていない見出しにはブックマークを付けない。^p1 の文字は消える
		expect(d.match(/<w:bookmarkStart /g)).toHaveLength(2);
		expect(d).toContain(">段落<");
	});

	it("ノートの埋め込み: 節だけを、見出しのレベルを保って取り込む（A-21）", async () => {
		const d = await doc((await convertNote("![[embed-source#節 B]]", {}, "word3a/x.md")).zip);
		expect(d).toContain("節 B の本文");
		expect(d).toContain('<w:pStyle w:val="Heading3"/>');
		expect(d).not.toContain("節 A の本文");
		expect(d).not.toContain("節 C の本文");
	});

	it("循環参照は止めてリンクにし、警告する（A-21）", async () => {
		const { zip, warnings } = await convertNote("![[cycle-a]]", {}, "word3a/x.md");
		const d = await doc(zip);
		expect(d).toContain("cycle-a の本文");
		expect(d).toContain("cycle-b の本文");
		expect(warnings.map((w) => w.code)).toEqual(["embedCycle"]);
		expect(warnings[0]!.detail).toBe("word3a/x.md → word3a/parts/cycle-a.md → word3a/parts/cycle-b.md → word3a/parts/cycle-a.md");
	});

	it("画像: 大きさの指定と本文の幅への縮小、SVG は PNG の代替画像付き（A-20）", async () => {
		const area = bodyArea(baseOptions("", new Map()).page);
		expect(imageSize({ width: 200 }, { width: 640, height: 400 }, area)).toEqual({ width: 200, height: 125 });
		expect(imageSize({ width: 300, height: 100 }, { width: 640, height: 400 }, area)).toEqual({ width: 300, height: 100 });
		expect(imageSize({}, { width: 1600, height: 900 }, area).width).toBe(Math.round(area.width));
		const zip = (await convertNote("![[sample-svg.svg]] ![[sample-png.png|代替|100]]", {}, "word3a/x.md")).zip;
		const media = Object.keys(zip.files).filter((f) => f.startsWith("word/media/"));
		expect(media.filter((f) => f.endsWith(".svg"))).toHaveLength(1);
		expect(media.filter((f) => f.endsWith(".png")).length).toBeGreaterThanOrEqual(1);
		expect(await doc(zip)).toContain('descr="代替"');
	});

	it("見つからない画像は文字で残して警告、外部 URL の画像はリンク（A-20）", async () => {
		const { zip, warnings } = await convertNote("![[ない.png]] ![logo](https://example.com/a.png)", {}, "word3a/x.md");
		expect(await doc(zip)).toContain("![[ない.png]]");
		expect(await xml(zip, "word/_rels/document.xml.rels")).toContain('Target="https://example.com/a.png"');
		expect(warnings).toEqual([{ code: "brokenLink", detail: "![[ない.png]]" }]);
	});

	it("PDF は obsidian://open のリンク、Canvas は文字のまま警告（A-22・A-23）", async () => {
		const { zip, warnings } = await convertNote("![[sample.pdf]]\n\n![[sample-canvas.canvas]]", {}, "word3a/x.md");
		expect(await xml(zip, "word/_rels/document.xml.rels")).toContain("obsidian://open?vault=test-vault&amp;file=word3a%2Fattachments%2Fsample.pdf");
		expect(warnings.map((w) => w.code)).toEqual(["unsupportedEmbed"]);
	});

	it("コールアウトは左の罫線が種類の色、背景が淡い色の 1 行 1 列の表（A-6）", async () => {
		expect(calloutColor("warning")).toBe("EC7500");
		expect(calloutColor("whatever")).toBe("086DDD");
		expect(lightColor("086DDD")).toBe("E6F0FC");
		const d = await doc(await convert("> [!warning]- 題\n> 本文\n> > [!tip]\n> > 内側"));
		expect(d).toMatch(/<w:left w:val="single" w:color="EC7500" w:sz="24"/);
		expect(d).toContain('w:fill="FDF1E6"');
		expect(d).toContain(">題<");
		expect(d).toContain(">Tip<");
		expect(d.match(/<w:tbl>/g)).toHaveLength(2);
	});

	it("コードはトークンの種類ごとに色を付け、行番号を付けられる（A-7）", async () => {
		expect(tokenColor(["string", "keyword"])).toBe("D73A49");
		expect(tokenColor(["unknown"])).toBeUndefined();
		const d = await doc(await convert('```ts\nconst a = "x";\n```', { codeLineNumbers: true }));
		expect(d).toContain('<w:color w:val="D73A49"/>');
		expect(d).toContain('<w:color w:val="032F62"/>');
		expect(d).toContain(">1  <");
	});

	it("脚注とインライン脚注は Word の脚注（A-10）", async () => {
		const zip = await convert("a[^1] b^[インライン] c[^1]\n\n[^1]: 定義");
		const d = await doc(zip);
		expect(d.match(/<w:footnoteReference w:id="1"\/>/g)).toHaveLength(2);
		expect(d).toContain('<w:footnoteReference w:id="2"/>');
		const notes = await xml(zip, "word/footnotes.xml");
		expect(notes).toContain(">定義<");
		expect(notes).toContain(">インライン<");
	});

	it("コメントは消える。オプションで Word のコメントにする（A-16）", async () => {
		const removed = await doc(await convert("a %%秘密%% b"));
		expect(removed).not.toContain("秘密");
		const zip = await convert("a %%秘密%% b");
		expect(zip.file("word/comments.xml")).toBeNull();
		const kept = await convertNote("a %%メモ%% b", {}, "test.md", { keepComments: true });
		expect(await doc(kept.zip)).toContain('<w:commentReference w:id="0"/>');
		expect(await xml(kept.zip, "word/comments.xml")).toContain(">メモ<");
	});

	it("インライン HTML の書式と改ページ（A-14・A-8）", async () => {
		const d = await doc(await convert('<u>u</u> x<sup>2</sup> H<sub>2</sub> <mark>m</mark> <span>s</span>a<br>b\n\n<div style="page-break-after: always"></div>'));
		expect(d).toContain('<w:u w:val="single"/>');
		expect(d).toContain('<w:vertAlign w:val="superscript"/>');
		expect(d).toContain('<w:vertAlign w:val="subscript"/>');
		expect(d).toContain('<w:highlight w:val="yellow"/>');
		expect(d).toContain('<w:br w:type="page"/>');
		expect(d).not.toContain("span");
	});

	it("frontmatter を文書プロパティにする（A-27）", async () => {
		const settings: PluginSettings = { ...DEFAULT_SETTINGS, authorName: "設定の作成者", frontmatterTable: true };
		const files = new Map<string, Uint8Array>();
		const deps: DocxExportDeps = {
			strictLineBreaks: undefined,
			readNote: async (p) => readFileSync(join(VAULT_DIR, p), "utf8"),
			renderer: { version: "11", render: async () => ({ svg: "<svg/>", png: PNG_1x1 }) },
			cache: { get: async () => null, put: async () => undefined },
			writer: {
				exists: async () => false,
				write: async (ref, bytes) => {
					files.set(refKey(ref), bytes);
					return { status: "success", contentHash: "h" };
				},
				hashOf: async () => "h",
				remove: async () => true,
			},
			vault: fakeVault,
		};
		await exportDocxNote("word3a/08-frontmatter.md", new AbortController().signal, settings, { entries: [] }, deps);
		const zip = await JSZip.loadAsync(files.get("vault:_export/word3a/08-frontmatter.docx")!);
		const core = await xml(zip, "docProps/core.xml");
		expect(core).toContain("<dc:title>frontmatter のタイトル</dc:title>");
		expect(core).toContain("<dc:creator>山田 太郎</dc:creator>");
		expect(core).toContain("<cp:keywords>sample, phase3a</cp:keywords>");
		expect(core).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-11-18T09:30:00Z</dcterms:created>');
		expect(await xml(zip, "docProps/custom.xml")).toContain("draft");
		expect(await doc(zip)).toContain(">status<");
	});

	it("相対 URL と変換対象の範囲", () => {
		expect(relativeUrl({ location: "vault", path: "_export/a/b.docx" }, { location: "vault", path: "_export/c d/e#1.docx" })).toBe("../c%20d/e%231.docx");
		expect(relativeUrl({ location: "vault", path: "x.docx" }, { location: "external", path: "y.docx" })).toBeNull();
		const manifest = { entries: [{ output: { location: "vault" as const, path: "_export/p.docx" }, sources: ["p.md"], kind: "docx" as const, contentHash: "h", writtenAt: "t" }] };
		expect([...convertedNotes(new Set(["a.md"]), manifest)].sort()).toEqual(["a.md", "p.md"]);
	});
});

describe("フェーズ 3b の要素", () => {
	const doc = async (zip: JSZip) => xml(zip, "word/document.xml");

	it("数式は Word の数式（OMML）。ブロックは中央の段落、インラインは文中（A-11）", async () => {
		const d = await doc(await convert("文中 $x^2$ の式。\n\n$$\n\\frac{a}{b}\n$$"));
		expect(d.match(/<m:oMath>/g)).toHaveLength(2);
		expect(d).toContain("<m:f>");
		expect(d).toContain("<m:sSup>");
		expect(d).not.toContain("$");
	});

	it("変換できない式は MathJax の画像、画像にもできなければ LaTeX のまま（A-11）", async () => {
		const { zip, warnings } = await convertNote("$\\sideset{_1}{_2}\\sum$ と $\\undefinedcommand{x}$");
		const d = await doc(zip);
		expect(d).toContain("<wp:inline");
		expect(d).toContain("$\\undefinedcommand{x}$");
		expect(warnings.map((w) => w.code)).toEqual(["mathAsImage", "mathFailed"]);
		const noMathJax = await convertNote("$\\sideset{_1}{_2}\\sum$", {}, "test.md", { keepComments: false }, { renderMath: undefined });
		expect(noMathJax.warnings.map((w) => w.code)).toEqual(["mathFailed"]);
	});

	it("描画できる言語は描画結果に置き換え、取り込んだ内部リンクを解決する（A-24・A-26）", async () => {
		const { zip, warnings } = await convertNote("```dataview\nTABLE status\n```", {}, "word3b/x.md");
		const d = await doc(zip);
		expect(d).toContain("<w:tbl>");
		expect(d).not.toContain("TABLE status");
		expect(await xml(zip, "word/_rels/document.xml.rels")).toContain('Target="data/データ%20A.docx"');
		expect(warnings).toEqual([]);
	});

	it("描画できなかったものと、Dataview がないものは原文のまま警告する。登録のない言語は警告しない", async () => {
		const failed = await convertNote("```dataviewjs\ndv.paragraph(1)\n```\n\n```other\nx\n```");
		expect(await doc(failed.zip)).toContain("dv.paragraph(1)");
		expect(failed.warnings).toEqual([{ code: "renderFailed", detail: "dataviewjs: timeout (10 s)" }]);
		const missing = await convertNote("```dataview\nLIST\n```", {}, "test.md", { keepComments: false }, { renderableLanguage: () => false });
		expect(missing.warnings).toEqual([{ code: "pluginMissing", detail: "dataview" }]);
	});

	it("外部の画像: オプションがオフならリンク、オンなら埋め込み、取得に失敗したらリンクのまま警告（A-20）", async () => {
		const md = "![logo|120](https://example.com/a.png) ![x](https://example.com/no-such.png)";
		const off = await convertNote(md);
		expect(await doc(off.zip)).not.toContain("<wp:inline");
		const on = await convertNote(md, {}, "test.md", { keepComments: false, downloadExternalImages: true });
		const d = await doc(on.zip);
		expect(d.match(/<wp:inline/g)).toHaveLength(1);
		expect(d).toContain('cx="1143000"'); // 幅 120 px = 1,143,000 EMU
		expect(await xml(on.zip, "word/_rels/document.xml.rels")).toContain("no-such.png");
		expect(on.warnings).toEqual([{ code: "imageFailed", detail: "https://example.com/no-such.png: HTTP 404" }]);
	});

	it("テーマのコールアウトの色が読めればその色、読めなければ固定の色（A-6）", async () => {
		const d = await doc((await convertNote("> [!tip] t\n\n> [!note] n", {}, "test.md", { keepComments: false }, { calloutColor: (type) => (type === "tip" ? "FF00AA" : undefined) })).zip);
		expect(d).toMatch(/w:color="FF00AA" w:sz="24"/);
		expect(d).toMatch(/w:color="086DDD" w:sz="24"/);
	});
});
