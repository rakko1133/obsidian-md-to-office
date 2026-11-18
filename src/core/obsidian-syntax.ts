// Obsidian 独自の記法を mdast の独自ノードにする変換（G2 の transform・フェーズ 3 のユーザー決定）。
// 1 つのノートの木に対して、構文解析の直後にかける。リンク先の解決や埋め込みの展開は note-assembly.ts が行う。
// Obsidian API に依存しない。
import type { BlockContent, Blockquote, Definition, Html, Paragraph, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import { COMMENT_MARK } from "./comments";
import { walk, walkParents } from "./markdown";

/** `[[…]]`・`![[…]]`、および Vault 内を指す Markdown のリンク・画像（A-18〜A-23）。 */
export interface WikiLink extends Parent {
	type: "wikiLink";
	/** リンク先（`#` より前）。空なら同じノートの中 */
	target: string;
	/** `#見出し`・`#^id`（なければ空） */
	subpath: string;
	/** `|` の後ろ（別名、埋め込みでは代替テキストや大きさ） */
	alias?: string;
	embed: boolean;
	/** 元の記法（解決できなかったときに残す文字） */
	raw: string;
	/** 表示する内容 */
	children: PhrasingContent[];
}

/** コールアウト（A-6）。 */
export interface Callout extends Parent {
	type: "callout";
	calloutType: string;
	title: PhrasingContent[];
	children: (BlockContent | RootContent)[];
}

/** インライン脚注 `^[…]`（A-10）。 */
export interface InlineFootnote extends Parent {
	type: "inlineFootnote";
	children: PhrasingContent[];
}

/** インライン HTML の書式（A-14）。 */
export interface HtmlFormat extends Parent {
	type: "htmlFormat";
	tag: "u" | "sup" | "sub" | "mark";
	children: PhrasingContent[];
}

/** 改ページ（A-8）。 */
export interface PageBreak {
	type: "pageBreak";
	data?: import("mdast").Data;
	position?: import("unist").Position;
}

/** Word のコメントにするコメントの位置（A-16 のオプション）。 */
export interface CommentMark {
	type: "commentMark";
	id: number;
	data?: import("mdast").Data;
	position?: import("unist").Position;
}

/** 文書内のブックマークへのリンク（A-19）。 */
export interface InternalLink extends Parent {
	type: "internalLink";
	anchor: string;
	children: PhrasingContent[];
}

/** 埋め込む画像（A-20）。画像のデータは note-assembly.ts が data.image に入れる。 */
export interface EmbedImage {
	type: "embedImage";
	/** Vault の中のパス（外部の画像や描画結果の画像では空） */
	path: string;
	/** 外部の画像の URL（A-20 のオプション: ダウンロードして埋め込む） */
	url?: string;
	alt: string;
	width?: number;
	height?: number;
	data?: import("mdast").Data;
	position?: import("unist").Position;
}

/** 埋め込む画像のデータ（Obsidian 側が読み込み、必要なら PNG にしたもの）。 */
export interface ImageAsset {
	type: "png" | "jpg" | "gif" | "bmp" | "svg";
	data: Uint8Array;
	/** SVG のときの PNG の代替画像 */
	fallback?: Uint8Array;
	/** 元の大きさ（CSS ピクセル） */
	width: number;
	height: number;
}

/** コードの色付けのトークン（A-7）。types は外側から内側への Prism のトークンの種類。 */
export interface CodeToken {
	text: string;
	types: string[];
}

declare module "mdast" {
	interface PhrasingContentMap {
		wikiLink: WikiLink;
		inlineFootnote: InlineFootnote;
		htmlFormat: HtmlFormat;
		commentMark: CommentMark;
		internalLink: InternalLink;
		embedImage: EmbedImage;
	}
	interface BlockContentMap {
		callout: Callout;
		pageBreak: PageBreak;
	}
	interface RootContentMap {
		wikiLink: WikiLink;
		inlineFootnote: InlineFootnote;
		htmlFormat: HtmlFormat;
		commentMark: CommentMark;
		internalLink: InternalLink;
		embedImage: EmbedImage;
		callout: Callout;
		pageBreak: PageBreak;
	}
	interface Data {
		/** ブロック ID `^id`（A-19） */
		blockId?: string;
		/** そのノードがあったノートのパス（見出し・ブロック ID の照合に使う） */
		sourcePath?: string;
		/** 付けるブックマークの名前（リンクされているときだけ） */
		bookmark?: string;
		/** 未対応の記法の原文（埋め込んだノートの原文を残すため） */
		original?: string;
		/** コードの色付けのトークン */
		tokens?: CodeToken[];
		/** 埋め込む画像のデータ */
		image?: ImageAsset;
		/** テーマから読んだコールアウトの色（A-6 のオプション） */
		calloutColor?: string;
	}
}

/** URL のスキーム（`https:`・`obsidian:` など）があるか。なければ Vault の中を指すとみなす。 */
export function hasScheme(url: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** 参照形式のリンク・画像（`[x][ref]`）を、定義の URL を使った通常のリンク・画像にし、定義を消す。 */
export function resolveReferences(tree: Root): void {
	const defs = new Map<string, Definition>();
	walk(tree, (node) => {
		if (node.type === "definition") defs.set(node.identifier, node);
	});
	walkParents(tree, (parent) => {
		const next: RootContent[] = [];
		for (const child of parent.children as RootContent[]) {
			if (child.type === "definition") continue;
			if (child.type === "linkReference") {
				const def = defs.get(child.identifier);
				next.push(def ? ({ type: "link", url: def.url, title: def.title ?? null, children: child.children, position: child.position } as RootContent) : child);
			} else if (child.type === "imageReference") {
				const def = defs.get(child.identifier);
				next.push(def ? ({ type: "image", url: def.url, title: def.title ?? null, alt: child.alt ?? "", position: child.position } as RootContent) : child);
			} else next.push(child);
		}
		(parent as Parent).children = next as Parent["children"];
	});
}

/** コメントの印を commentMark のノードにする（A-16 のオプション）。 */
export function markCommentMarks(tree: Root): void {
	splitTexts(tree, COMMENT_MARK, (m) => ({ type: "commentMark", id: Number(m[1]) }));
}

const WIKILINK = /(!?)\[\[([^[\]]+?)\]\]/g;

/** テキストの中の `[[…]]`・`![[…]]` を wikiLink のノードにする。 */
export function markWikiLinks(tree: Root): void {
	splitTexts(tree, WIKILINK, (m) => {
		const inner = m[2]!;
		const bar = inner.indexOf("|");
		const linkPart = bar === -1 ? inner : inner.slice(0, bar);
		const alias = bar === -1 ? undefined : inner.slice(bar + 1);
		const hash = linkPart.indexOf("#");
		const target = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim();
		const subpath = hash === -1 ? "" : linkPart.slice(hash).trim();
		const link: WikiLink = { type: "wikiLink", target, subpath, embed: m[1] === "!", raw: m[0], children: [] };
		if (alias !== undefined) link.alias = alias;
		link.children = [{ type: "text", value: wikiDisplay(link) }];
		return link;
	});
}

/** リンクの表示文字（Obsidian の表示に合わせる: 別名、`ノート > 見出し`、`見出し`）。 */
export function wikiDisplay(link: Pick<WikiLink, "target" | "subpath" | "alias">): string {
	if (link.alias !== undefined && link.alias !== "") return link.alias;
	const parts = link.subpath.split("#").filter((p) => p !== "");
	const sub = parts.join(" > ");
	if (link.target === "") return sub;
	return sub === "" ? link.target : `${link.target} > ${sub}`;
}

/** Vault の中を指す Markdown のリンク `[x](note.md#見出し)` と画像 `![alt|300](pic.png)` を wikiLink にする。外部 URL の画像はリンクにする（A-20）。 */
export function convertMarkdownLinks(tree: Root, options: { downloadExternalImages: boolean } = { downloadExternalImages: false }): void {
	walkParents(tree, (parent) => {
		parent.children = (parent.children as RootContent[]).map((child) => {
			if (child.type === "link" && !hasScheme(child.url)) {
				const { target, subpath } = splitUrl(child.url);
				return { type: "wikiLink", target, subpath, embed: false, raw: `[${plainText(child.children)}](${child.url})`, children: child.children, position: child.position } satisfies WikiLink;
			}
			if (child.type === "image") {
				if (hasScheme(child.url) && options.downloadExternalImages && /^https?:/i.test(child.url)) {
					const alt = child.alt?.split("|")[0] || child.url;
					const size = /\|\s*(\d+)(?:\s*x\s*(\d+))?\s*$/.exec(child.alt ?? "");
					const image: EmbedImage = { type: "embedImage", path: "", url: child.url, alt, position: child.position };
					if (size) {
						image.width = Number(size[1]);
						if (size[2] !== undefined) image.height = Number(size[2]);
					}
					return image;
				}
				if (hasScheme(child.url)) {
					const label = child.alt?.split("|")[0] || child.url;
					return { type: "link", url: child.url, title: null, children: [{ type: "text", value: label }], position: child.position };
				}
				const { target, subpath } = splitUrl(child.url);
				const link: WikiLink = { type: "wikiLink", target, subpath, embed: true, raw: `![${child.alt ?? ""}](${child.url})`, children: [], position: child.position };
				if (child.alt) link.alias = child.alt;
				link.children = [{ type: "text", value: child.alt?.split("|")[0] || target }];
				return link;
			}
			return child;
		}) as Parent["children"];
	});
}

function splitUrl(url: string): { target: string; subpath: string } {
	let decoded = url;
	try {
		decoded = decodeURI(url);
	} catch {
		// そのまま使う
	}
	const hash = decoded.indexOf("#");
	return hash === -1 ? { target: decoded, subpath: "" } : { target: decoded.slice(0, hash), subpath: decoded.slice(hash) };
}

const BLOCK_ID_AT_END = /(^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;

/** 段落の末尾のブロック ID `^id` を本文から消し、そのブロックの data.blockId にする（A-19）。 */
export function markBlockIds(tree: Root, sourcePath: string): void {
	walkParents(tree, (parent) => {
		const next: RootContent[] = [];
		for (const child of parent.children as RootContent[]) {
			if (child.type === "paragraph") {
				const last = child.children[child.children.length - 1];
				const m = last?.type === "text" ? BLOCK_ID_AT_END.exec(last.value) : null;
				if (last?.type === "text" && m) {
					last.value = last.value.slice(0, m.index).replace(/[ \t]+$/, "");
					if (last.value === "") child.children.pop();
					const empty = child.children.length === 0 || child.children.every((c) => c.type === "text" && c.value.trim() === "");
					// 単独の行の `^id` は、直前のブロック（表・引用など）の ID
					const owner = empty ? next[next.length - 1] : parent.type === "listItem" && next.length === 0 ? parent : child;
					if (owner) {
						owner.data = { ...owner.data, blockId: m[2]!, sourcePath };
						if (empty) continue;
					}
				}
			}
			next.push(child);
		}
		parent.children = next as Parent["children"];
	});
}

/** 見出しに、照合用のノートのパスを付ける。 */
export function markHeadingSources(tree: Root, sourcePath: string): void {
	walk(tree, (node) => {
		if (node.type === "heading") node.data = { ...node.data, sourcePath };
	});
}

const CALLOUT_HEAD = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/;

/** 引用の先頭が `[!type]` ならコールアウトにする（A-6）。入れ子の引用も同じように扱う。 */
export function markCallouts(tree: Root): void {
	walk(tree, (node) => {
		if (node.type !== "blockquote") return;
		const first = node.children[0];
		if (first?.type !== "paragraph") return;
		const head = first.children[0];
		if (head?.type !== "text") return;
		const m = CALLOUT_HEAD.exec(head.value);
		if (!m) return;
		head.value = head.value.slice(m[0].length);
		// 1 行目がタイトル、2 行目以降が本文
		const title: PhrasingContent[] = [];
		const body: PhrasingContent[] = [];
		let inBody = false;
		for (const child of first.children) {
			if (inBody) {
				body.push(child);
				continue;
			}
			if (child.type === "text" && child.value.includes("\n")) {
				const at = child.value.indexOf("\n");
				if (at > 0) title.push({ type: "text", value: child.value.slice(0, at) });
				if (at + 1 < child.value.length) body.push({ type: "text", value: child.value.slice(at + 1) });
				inBody = true;
			} else if (child.type === "break") {
				inBody = true;
			} else title.push(child);
		}
		const type = m[1]!.toLowerCase();
		const titleIsEmpty = title.every((c) => c.type === "text" && c.value.trim() === "");
		const rest = node.children.slice(1);
		const callout = node as unknown as Callout;
		callout.type = "callout";
		callout.calloutType = type;
		callout.title = titleIsEmpty ? [{ type: "text", value: type.charAt(0).toUpperCase() + type.slice(1) }] : title;
		callout.children = body.length > 0 ? [{ type: "paragraph", children: body } as Paragraph, ...rest] : rest;
	});
}

/** インライン脚注 `^[…]` を inlineFootnote のノードにする（A-10）。強調などで分かれたテキストもまたいで探す。 */
export function markInlineFootnotes(tree: Root): void {
	walkParents(tree, (parent) => {
		const children = parent.children as PhrasingContent[];
		for (let i = 0; i < children.length; i++) {
			const node = children[i]!;
			if (node.type !== "text") continue;
			const open = node.value.indexOf("^[");
			if (open === -1) continue;
			// 閉じ括弧を、同じテキストか後ろの兄弟のテキストから探す（括弧の入れ子を数える）
			let depth = 0;
			let close: { index: number; offset: number } | null = null;
			for (let j = i; j < children.length && !close; j++) {
				const c = children[j]!;
				if (c.type !== "text") continue;
				const from = j === i ? open + 2 : 0;
				for (let k = from; k < c.value.length; k++) {
					if (c.value[k] === "[") depth++;
					else if (c.value[k] === "]") {
						if (depth === 0) {
							close = { index: j, offset: k };
							break;
						}
						depth--;
					}
				}
			}
			if (!close) continue;
			const before = node.value.slice(0, open);
			const inner: PhrasingContent[] = [];
			let after: Text | null = null;
			if (close.index === i) {
				inner.push({ type: "text", value: node.value.slice(open + 2, close.offset) });
				after = { type: "text", value: node.value.slice(close.offset + 1) };
			} else {
				const head = node.value.slice(open + 2);
				if (head) inner.push({ type: "text", value: head });
				inner.push(...children.slice(i + 1, close.index));
				const last = children[close.index] as Text;
				if (close.offset > 0) inner.push({ type: "text", value: last.value.slice(0, close.offset) });
				after = { type: "text", value: last.value.slice(close.offset + 1) };
			}
			const replacement: PhrasingContent[] = [];
			if (before) replacement.push({ type: "text", value: before });
			replacement.push({ type: "inlineFootnote", children: inner });
			if (after.value) replacement.push(after);
			children.splice(i, close.index - i + 1, ...replacement);
		}
	});
}

const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition", "callout"]);
const FORMAT_TAGS = new Set(["u", "sup", "sub", "mark"]);

/** HTML を扱う（A-14・A-8）。書式のタグは書式に、改ページの div は改ページに、それ以外はタグを除いて文字だけ残す。 */
export function markHtml(tree: Root): void {
	walkParents(tree, (parent) => {
		if (BLOCK_PARENTS.has(parent.type)) {
			parent.children = (parent.children as RootContent[]).flatMap((child): RootContent[] => {
				if (child.type !== "html") return [child];
				if (/page-break-(after|before)\s*:\s*always/i.test(child.value)) return [{ type: "pageBreak" }];
				const text = htmlToText(child.value);
				return text === "" ? [] : [{ type: "paragraph", children: [{ type: "text", value: text }] }];
			}) as Parent["children"];
			return;
		}
		parent.children = wrapInlineHtml(parent.children as PhrasingContent[]) as Parent["children"];
	});
}

function wrapInlineHtml(children: PhrasingContent[]): PhrasingContent[] {
	const out: PhrasingContent[] = [];
	for (let i = 0; i < children.length; i++) {
		const child = children[i]!;
		if (child.type !== "html") {
			out.push(child);
			continue;
		}
		const value = (child as Html).value.trim();
		if (/^<br\s*\/?>$/i.test(value)) {
			out.push({ type: "break" });
			continue;
		}
		const open = /^<([a-z]+)(\s[^>]*)?>$/i.exec(value);
		const tag = open?.[1]?.toLowerCase();
		if (tag && FORMAT_TAGS.has(tag)) {
			// 同じ並びの中で対応する閉じタグを探す
			let depth = 0;
			let close = -1;
			for (let j = i + 1; j < children.length; j++) {
				const c = children[j]!;
				if (c.type !== "html") continue;
				const v = c.value.trim().toLowerCase();
				if (new RegExp(`^<${tag}(\\s[^>]*)?>$`).test(v)) depth++;
				else if (v === `</${tag}>`) {
					if (depth === 0) {
						close = j;
						break;
					}
					depth--;
				}
			}
			if (close !== -1) {
				out.push({ type: "htmlFormat", tag: tag as HtmlFormat["tag"], children: children.slice(i + 1, close) });
				i = close;
				continue;
			}
		}
		// それ以外のタグは除く（タグの外の文字は別のテキストのノードなので残る）
		const text = htmlToText((child as Html).value);
		if (text !== "") out.push({ type: "text", value: text });
	}
	return out;
}

/** タグを除いて文字だけにする。`<br>` は改行にし、よく使う文字参照を戻す。 */
export function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.trim();
}

/** テキストのノードを正規表現で分け、一致した部分を make で作ったノードにする。 */
function splitTexts(tree: Root, pattern: RegExp, make: (m: RegExpMatchArray) => PhrasingContent): void {
	walkParents(tree, (parent) => {
		if (parent.type === "link" || parent.type === "wikiLink") return;
		let changed = false;
		const next: RootContent[] = [];
		for (const child of parent.children as RootContent[]) {
			if (child.type !== "text") {
				next.push(child);
				continue;
			}
			let last = 0;
			const value = (child as Text).value;
			for (const m of value.matchAll(new RegExp(pattern.source, "g"))) {
				changed = true;
				if (m.index! > last) next.push({ type: "text", value: value.slice(last, m.index) });
				next.push(make(m) as RootContent);
				last = m.index! + m[0].length;
			}
			if (last === 0) next.push(child);
			else if (last < value.length) next.push({ type: "text", value: value.slice(last) });
		}
		if (changed) parent.children = next as Parent["children"];
	});
}

/** 見出しやリンクの文字（照合用）。 */
export function plainText(nodes: readonly PhrasingContent[] | readonly RootContent[]): string {
	let out = "";
	for (const node of nodes) {
		if ("value" in node && typeof node.value === "string" && node.type !== "html") out += node.value;
		else if ("children" in node) out += plainText(node.children as PhrasingContent[]);
	}
	return out;
}

/** 見出しの照合用の正規化（大文字小文字と空白の違いを無視する）。 */
export function normalizeHeading(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export type { Blockquote };
