// ノート 1 件の木を組み立てる（04 → 05 → 07 の間・フェーズ 3a）。
// 構文解析 → Obsidian 独自の記法の変換 → ノートの埋め込みの展開（A-21）→ Mermaid の連番 → リンクの解決（A-18・A-19・A-22）
// → 画像とコードの色付けの準備（A-20・A-7）。Obsidian API に依存しない。Vault の読み書きは NoteEnvironment に任せる。
import type { Code, List, ListItem, Paragraph, Parent, PhrasingContent, Root, RootContent } from "mdast";
import { COMMENT_MARK, stripComments } from "./comments";
import { markHighlight, markMermaid, markTaskStates, markUnsupported, parseMarkdown, walk } from "./markdown";
import {
	convertMarkdownLinks,
	markBlockIds,
	markCallouts,
	markHeadingSources,
	markHtml,
	markInlineFootnotes,
	markWikiLinks,
	normalizeHeading,
	plainText,
	resolveReferences,
	type CodeToken,
	type EmbedImage,
	type ImageAsset,
	type WikiLink,
} from "./obsidian-syntax";
import type { Warning } from "./types";

/** 埋め込みの深さの上限（フェーズ 3 の決定事項: 固定）。 */
export const MAX_EMBED_DEPTH = 5;

/** 画像として埋め込む拡張子（A-20）。 */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);

/** Vault の読み取りとリンクの解決（Obsidian 側が実装する）。 */
export interface NoteEnvironment {
	readNote(path: string): Promise<string>;
	/** リンク先のファイルのパス（Vault からの相対）。解決できなければ null（getFirstLinkpathDest） */
	resolveLink(linkpath: string, sourcePath: string): string | null;
	fileExists(path: string): boolean;
	/** 変換対象か（今回の対象 + マニフェストに .docx として記録されたノート: A-18） */
	isConverted(path: string): boolean;
	/** 変換対象のノートの .docx への、変換中のノートの .docx からの相対 URL。作れなければ null */
	docxLink(targetPath: string): string | null;
	/** obsidian://open の URI に入れる Vault の名前（A-22） */
	vaultName: string;
	/** 画像を読み、Word が扱える形式にする（A-20）。なければ画像は埋め込まない */
	loadImage?(path: string): Promise<ImageAsset>;
	/** コードをトークンに分ける（A-7）。言語が分からなければ null */
	highlight?(code: string, lang: string): CodeToken[] | null;
}

export interface AssembleOptions {
	/** `%%…%%` を Word のコメントとして残す（A-16 のオプション） */
	keepComments: boolean;
}

export interface AssembledNote {
	tree: Root;
	/** 元のノートの Markdown（コメントを除いたもの） */
	source: string;
	/** Word のコメントにするコメントの中身。commentMark の id が添字 */
	comments: string[];
	warnings: Warning[];
}

interface State {
	env: NoteEnvironment;
	options: AssembleOptions;
	warnings: Warning[];
	comments: string[];
	noteCount: number;
}

export async function assembleNote(rootPath: string, env: NoteEnvironment, options: AssembleOptions): Promise<AssembledNote> {
	const state: State = { env, options, warnings: [], comments: [], noteCount: 0 };
	const { tree, source } = await loadNote(rootPath, state);
	await expandEmbeds(tree, rootPath, state, [rootPath], 0);
	markMermaid(tree);
	resolveLinks(tree, rootPath, state);
	await prepareAssets(tree, state);
	return { tree, source, comments: state.comments, warnings: dedupe(state.warnings) };
}

/** ノート 1 件を読み、構文解析と独自の記法の変換をかける。 */
async function loadNote(path: string, state: State): Promise<{ tree: Root; source: string }> {
	const raw = await state.env.readNote(path);
	const { text, comments } = stripComments(raw, state.options.keepComments);
	const offset = state.comments.length;
	// Word のコメントにしないときは、中身を持たない（comments.xml を作らない）
	if (state.options.keepComments) state.comments.push(...comments);
	const noteNo = state.noteCount++;
	const tree = parseMarkdown(text);

	resolveReferences(tree);
	if (state.options.keepComments) {
		splitCommentMarks(tree, offset);
	}
	markWikiLinks(tree);
	convertMarkdownLinks(tree);
	markBlockIds(tree, path);
	markHeadingSources(tree, path);
	markCallouts(tree);
	markInlineFootnotes(tree);
	markHtml(tree);
	markHighlight(tree);
	markTaskStates(tree);
	const ctx = { warnings: state.warnings };
	markUnsupported(tree, ctx);

	walkAll(tree, (node) => {
		if (node.type === "wikiLink") node.data = { ...node.data, sourcePath: path };
		if (node.data?.unsupported && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
			node.data.original = text.slice(node.position.start.offset, node.position.end.offset);
		}
		// 埋め込んだノートの脚注の番号が重ならないよう、ノートごとに識別子を分ける
		if (noteNo > 0 && (node.type === "footnoteReference" || node.type === "footnoteDefinition")) node.identifier = `${noteNo}:${node.identifier}`;
	});
	return { tree, source: text };
}

function splitCommentMarks(tree: Root, offset: number): void {
	mapPhrasing(tree, (child) => {
		if (child.type !== "text" || !child.value.includes("")) return [child];
		const out: PhrasingContent[] = [];
		let last = 0;
		for (const m of child.value.matchAll(new RegExp(COMMENT_MARK.source, "g"))) {
			if (m.index! > last) out.push({ type: "text", value: child.value.slice(last, m.index) });
			out.push({ type: "commentMark", id: offset + Number(m[1]) });
			last = m.index! + m[0].length;
		}
		if (last < child.value.length) out.push({ type: "text", value: child.value.slice(last) });
		return out;
	});
}

// ---------------------------------------------------------------------------
// 埋め込み（A-20〜A-23）

const MEDIA_EXTENSIONS = new Set(["pdf", "mp3", "wav", "m4a", "ogg", "flac", "3gp", "webm", "mp4", "mov", "mkv", "ogv"]);
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition", "callout"]);

function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function isExcalidraw(path: string): boolean {
	return /\.excalidraw(\.md)?$/i.test(path);
}

function isNote(path: string): boolean {
	return extensionOf(path) === "md" && !isExcalidraw(path);
}

/** obsidian://open の URI（A-22）。 */
export function obsidianOpenUri(vaultName: string, path: string): string {
	return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path)}`;
}

/** 埋め込みの `|` の後ろを、代替テキストと大きさ（`300`・`300x200`）に分ける。 */
export function parseImageAlias(alias: string | undefined): { alt: string; width?: number; height?: number } {
	if (alias === undefined) return { alt: "" };
	const parts = alias.split("|");
	const size = /^\s*(\d+)(?:\s*x\s*(\d+))?\s*$/.exec(parts[parts.length - 1]!);
	if (!size) return { alt: alias.trim() };
	const out: { alt: string; width?: number; height?: number } = { alt: parts.slice(0, -1).join("|").trim(), width: Number(size[1]) };
	if (size[2] !== undefined) out.height = Number(size[2]);
	return out;
}

/** Excalidraw の図の、書き出し済みの画像を探す（`名前.excalidraw.svg` と `名前.svg` の両方を見る）。 */
function excalidrawImage(path: string, env: NoteEnvironment): string | null {
	const withoutMd = path.replace(/\.md$/i, "");
	const withoutExcalidraw = withoutMd.replace(/\.excalidraw$/i, "");
	for (const stem of [withoutMd, withoutExcalidraw]) {
		for (const ext of ["svg", "png"]) {
			if (env.fileExists(`${stem}.${ext}`)) return `${stem}.${ext}`;
		}
	}
	return null;
}

/** ノート以外の埋め込み（画像・PDF・Canvas など）を、置き換えるノードにする。ノートの埋め込みなら null。 */
function embedReplacement(link: WikiLink, state: State): PhrasingContent[] | null {
	const source = link.data?.sourcePath ?? "";
	const path = link.target === "" ? source : state.env.resolveLink(link.target, source);
	if (!path) {
		state.warnings.push({ code: "brokenLink", detail: link.raw || link.target });
		return [{ type: "text", value: link.raw || link.target }];
	}
	if (isNote(path)) return null;
	const ext = extensionOf(path);
	if (IMAGE_EXTENSIONS.has(ext)) return [image(path, link)];
	if (isExcalidraw(path)) {
		const exported = excalidrawImage(path, state.env);
		if (exported) return [image(exported, link)];
		state.warnings.push({ code: "unsupportedEmbed", detail: `excalidraw: ${path}` });
		return [{ type: "inlineCode", value: link.raw || path }];
	}
	if (ext === "canvas") {
		state.warnings.push({ code: "unsupportedEmbed", detail: `canvas: ${path}` });
		return [{ type: "inlineCode", value: link.raw || path }];
	}
	// PDF・音声・動画・そのほかのファイルは、元のファイルを開くリンク（A-22）
	const name = path.slice(path.lastIndexOf("/") + 1);
	const label = MEDIA_EXTENSIONS.has(ext) ? name : link.alias || name;
	return [{ type: "link", url: obsidianOpenUri(state.env.vaultName, path), title: null, children: [{ type: "text", value: label }] }];
}

function image(path: string, link: WikiLink): EmbedImage {
	const { alt, width, height } = parseImageAlias(link.alias);
	const node: EmbedImage = { type: "embedImage", path, alt: alt || path.slice(path.lastIndexOf("/") + 1) };
	if (width !== undefined) node.width = width;
	if (height !== undefined) node.height = height;
	return node;
}

async function expandEmbeds(tree: Root, notePath: string, state: State, stack: string[], depth: number): Promise<void> {
	// 1. ノート以外の埋め込みを、どこにあっても置き換える
	mapPhrasing(tree, (child) => {
		if (child.type !== "wikiLink" || !child.embed) return [child];
		return embedReplacement(child, state) ?? [child];
	});
	// 2. 段落の中のノートの埋め込みを、ブロックとして展開する
	await expandIn(tree, state, stack, depth, new WeakSet());
	// 3. 展開できない場所（見出し・表のセル）のノートの埋め込みは、リンクにする
	mapPhrasing(tree, (child) => {
		if (child.type === "wikiLink" && child.embed) child.embed = false;
		return [child];
	});
	void notePath;
}

async function expandIn(parent: Parent, state: State, stack: string[], depth: number, done: WeakSet<object>): Promise<void> {
	if (BLOCK_PARENTS.has(parent.type)) {
		const next: RootContent[] = [];
		for (const child of parent.children as RootContent[]) {
			if (child.type === "paragraph" && child.children.some((c) => c.type === "wikiLink" && c.embed)) {
				for (const block of await splitParagraph(child, state, stack, depth)) {
					done.add(block);
					next.push(block);
				}
			} else next.push(child);
		}
		parent.children = next as Parent["children"];
	}
	for (const child of parent.children as RootContent[]) {
		if ("children" in child && !done.has(child)) await expandIn(child as Parent, state, stack, depth, done);
	}
}

/** 段落を、埋め込みの前の文・埋め込んだノートのブロック・後ろの文に分ける。 */
async function splitParagraph(paragraph: Paragraph, state: State, stack: string[], depth: number): Promise<RootContent[]> {
	const out: RootContent[] = [];
	let run: PhrasingContent[] = [];
	const flush = () => {
		if (run.some((c) => !(c.type === "text" && c.value.trim() === "") && c.type !== "break")) out.push({ type: "paragraph", children: trimRun(run), data: paragraph.data } as Paragraph);
		run = [];
	};
	for (const child of paragraph.children) {
		if (child.type !== "wikiLink" || !child.embed) {
			run.push(child);
			continue;
		}
		const blocks = await embedNote(child, state, stack, depth);
		if (!blocks) {
			child.embed = false;
			run.push(child);
			continue;
		}
		flush();
		out.push(...blocks);
	}
	flush();
	return out;
}

function trimRun(run: PhrasingContent[]): PhrasingContent[] {
	const out = [...run];
	while (out[0]?.type === "break") out.shift();
	while (out[out.length - 1]?.type === "break") out.pop();
	const first = out[0];
	if (first?.type === "text") out[0] = { ...first, value: first.value.replace(/^\s+/, "") };
	const last = out[out.length - 1];
	if (last?.type === "text") out[out.length - 1] = { ...last, value: last.value.replace(/\s+$/, "") };
	return out;
}

/** ノートを埋め込む（A-21）。埋め込めなければ null（リンクとして残す）。 */
async function embedNote(link: WikiLink, state: State, stack: string[], depth: number): Promise<RootContent[] | null> {
	const source = link.data?.sourcePath ?? "";
	const path = link.target === "" ? source : state.env.resolveLink(link.target, source);
	if (!path) return null;
	if (stack.includes(path)) {
		state.warnings.push({ code: "embedCycle", detail: [...stack, path].join(" → ") });
		return null;
	}
	if (depth + 1 > MAX_EMBED_DEPTH) {
		state.warnings.push({ code: "embedDepth", detail: path });
		return null;
	}
	const { tree } = await loadNote(path, state);
	const blocks = extractSection(tree, link.subpath);
	if (!blocks) {
		state.warnings.push({ code: "brokenLink", detail: link.raw || `${link.target}${link.subpath}` });
		return null;
	}
	const sub: Root = { type: "root", children: blocks };
	await expandEmbeds(sub, path, state, [...stack, path], depth + 1);
	return sub.children;
}

/** 埋め込む範囲を取り出す: 全体、`#見出し` の節、`#^id` のブロック（A-21）。 */
export function extractSection(tree: Root, subpath: string): RootContent[] | null {
	const body = tree.children.filter((c) => c.type !== "yaml");
	if (subpath === "" || subpath === "#") return body;
	const segments = subpath.split("#").filter((s) => s !== "");
	const last = segments[segments.length - 1] ?? "";
	if (last.startsWith("^")) {
		const id = last.slice(1);
		let found: RootContent[] | null = null;
		const search = (parent: Parent): void => {
			for (const child of parent.children as RootContent[]) {
				if (found) return;
				if (child.data?.blockId === id) {
					found = child.type === "listItem" ? [{ type: "list", ordered: (parent as List).ordered ?? false, spread: false, children: [child as ListItem] } as List] : [child];
					return;
				}
				if ("children" in child) search(child as Parent);
			}
		};
		search(tree);
		return found;
	}
	const key = normalizeHeading(last);
	const start = body.findIndex((c) => c.type === "heading" && normalizeHeading(plainText(c.children)) === key);
	if (start === -1) return null;
	const depth = (body[start] as { depth: number }).depth;
	let end = start + 1;
	while (end < body.length) {
		const c = body[end]!;
		if (c.type === "heading" && c.depth <= depth) break;
		end++;
	}
	return body.slice(start, end);
}

// ---------------------------------------------------------------------------
// リンクの解決（A-18・A-19・A-22）

function resolveLinks(tree: Root, rootPath: string, state: State): void {
	// 見出しとブロック ID の索引（ノートのパス + `#見出し` / `#^id`）
	const anchors = new Map<string, RootContent>();
	walkAll(tree, (node) => {
		const src = node.data?.sourcePath;
		if (!src) return;
		if (node.type === "heading") {
			const key = `${src}#${normalizeHeading(plainText(node.children))}`;
			if (!anchors.has(key)) anchors.set(key, node);
		}
		if (node.data?.blockId) {
			const key = `${src}#^${node.data.blockId}`;
			if (!anchors.has(key)) anchors.set(key, node);
		}
	});
	const names = new BookmarkNames();

	mapPhrasing(tree, (child) => {
		if (child.type !== "wikiLink") return [child];
		const link = child;
		const display = link.children;
		const source = link.data?.sourcePath ?? rootPath;
		const path = link.target === "" ? source : state.env.resolveLink(link.target, source);
		if (!path) {
			state.warnings.push({ code: "brokenLink", detail: link.raw || link.target });
			return display;
		}
		if (link.subpath !== "") {
			const segments = link.subpath.split("#").filter((s) => s !== "");
			const last = segments[segments.length - 1] ?? "";
			const key = last.startsWith("^") ? `${path}#${last}` : `${path}#${normalizeHeading(last)}`;
			const target = anchors.get(key);
			if (target) {
				target.data = { ...target.data, bookmark: target.data?.bookmark ?? names.next(target) };
				return [{ type: "internalLink", anchor: target.data.bookmark!, children: display }];
			}
			if (link.target === "") {
				state.warnings.push({ code: "brokenLink", detail: link.raw || link.subpath });
				return display;
			}
		}
		if (isNote(path)) {
			if (path === rootPath || !state.env.isConverted(path)) return display;
			const url = state.env.docxLink(path);
			return url ? [{ type: "link", url, title: null, children: display }] : display;
		}
		return [{ type: "link", url: obsidianOpenUri(state.env.vaultName, path), title: null, children: display }];
	});
}

/** ブックマークの名前（Word の制約: 40 文字以内、英数字と `_`、先頭は英字）。 */
class BookmarkNames {
	private headings = 0;
	private readonly used = new Set<string>();

	next(node: RootContent): string {
		let name: string;
		if (node.type === "heading") name = `h_${++this.headings}`;
		else name = `b_${(node.data?.blockId ?? "").replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 36);
		let unique = name;
		for (let n = 2; this.used.has(unique); n++) unique = `${name}_${n}`;
		this.used.add(unique);
		return unique;
	}
}

// ---------------------------------------------------------------------------
// 画像とコードの色付けの準備（A-20・A-7）

async function prepareAssets(tree: Root, state: State): Promise<void> {
	const images: EmbedImage[] = [];
	const codes: Code[] = [];
	walkAll(tree, (node) => {
		if (node.type === "embedImage") images.push(node);
		if (node.type === "code" && node.lang && node.data?.mermaidIndex === undefined) codes.push(node);
	});
	if (state.env.loadImage) {
		for (const node of images) {
			try {
				node.data = { ...node.data, image: await state.env.loadImage(node.path) };
			} catch (error) {
				state.warnings.push({ code: "imageFailed", detail: `${node.path}: ${error instanceof Error ? error.message : String(error)}` });
			}
		}
	}
	if (state.env.highlight) {
		for (const node of codes) {
			const tokens = state.env.highlight(node.value, node.lang!);
			if (tokens) node.data = { ...node.data, tokens };
		}
	}
}

// ---------------------------------------------------------------------------
// 巡回

/** 木のすべてのノードを巡回する（コールアウトのタイトルも含む）。 */
export function walkAll(tree: Root | RootContent, visit: (node: RootContent) => void): void {
	walk(tree as Root, (node) => {
		visit(node);
		if (node.type === "callout") for (const t of node.title) walkAll(t, visit);
	});
}

/** インラインの並びを持つすべての親で、子を map で置き換える（コールアウトのタイトルも含む）。 */
function mapPhrasing(tree: Root, map: (child: PhrasingContent) => PhrasingContent[]): void {
	const visitParent = (parent: Parent): void => {
		if (parent.type === "callout") {
			const callout = parent as unknown as { title: PhrasingContent[] };
			callout.title = callout.title.flatMap(map);
			for (const t of callout.title) if ("children" in t) visitParent(t as Parent);
		}
		if (!BLOCK_PARENTS.has(parent.type) && parent.type !== "list" && parent.type !== "table" && parent.type !== "tableRow") {
			parent.children = (parent.children as PhrasingContent[]).flatMap(map) as Parent["children"];
		}
		for (const child of parent.children as RootContent[]) if ("children" in child) visitParent(child as Parent);
	};
	visitParent(tree);
}

function dedupe(warnings: Warning[]): Warning[] {
	const seen = new Set<string>();
	return warnings.filter((w) => {
		const key = `${w.code}\u0000${w.detail ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
