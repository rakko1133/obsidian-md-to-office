// 描画結果の DOM → mdast（フェーズ 3b のユーザー決定: hast を経由しない自作の小さな変換）。
// Obsidian に描画させた dataview・dataviewjs・他のプラグインのコードブロックの結果を取り込む（A-24・A-26）。
// 表・リスト（タスクを含む）・段落・見出し・リンク・強調・コード・画像を mdast にし、それ以外の要素は文字だけ残す。
// DOM の型には依存せず、必要な性質だけを持つ DomNodeLike を受け取る（テストでは偽の DOM を使う）。Obsidian API に依存しない。
import type { BlockContent, List, ListItem, Paragraph, PhrasingContent, RootContent, Table, TableCell, TableRow } from "mdast";
import type { EmbedImage, ImageAsset, WikiLink } from "./obsidian-syntax";
import { wikiDisplay } from "./obsidian-syntax";

export interface DomNodeLike {
	/** 1: 要素、3: テキスト */
	nodeType: number;
	textContent: string | null;
	childNodes: ArrayLike<DomNodeLike>;
	tagName?: string;
	getAttribute?(name: string): string | null;
}

export interface DomConvertHooks {
	/** svg・canvas・img を画像にする。できなければ null */
	image(el: DomNodeLike): Promise<ImageAsset | null>;
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "pre", "blockquote", "hr", "div", "section", "article", "header", "footer", "main", "nav", "details", "figure", "dl"]);
const CONTAINER_TAGS = new Set(["div", "section", "article", "header", "footer", "main", "nav", "details", "figure", "dl", "summary"]);
const IMAGE_TAGS = new Set(["svg", "canvas", "img"]);
const SKIP_TAGS = new Set(["script", "style", "button", "input", "template"]);

const tag = (node: DomNodeLike): string => (node.nodeType === 1 ? (node.tagName ?? "").toLowerCase() : "");
const attr = (node: DomNodeLike, name: string): string | null => node.getAttribute?.(name) ?? null;
const children = (node: DomNodeLike): DomNodeLike[] => Array.from(node.childNodes);

function isBlock(node: DomNodeLike): boolean {
	return node.nodeType === 1 && BLOCK_TAGS.has(tag(node));
}

/** 要素の子を、ブロックの並びにする。 */
export async function domToMdast(root: DomNodeLike, hooks: DomConvertHooks): Promise<RootContent[]> {
	return blocksOf(children(root), hooks);
}

async function blocksOf(nodes: DomNodeLike[], hooks: DomConvertHooks): Promise<RootContent[]> {
	const out: RootContent[] = [];
	let inline: DomNodeLike[] = [];
	const flush = async () => {
		const phrasing = trimPhrasing(await phrasingOf(inline, hooks));
		if (phrasing.length > 0) out.push({ type: "paragraph", children: phrasing });
		inline = [];
	};
	for (const node of nodes) {
		if (node.nodeType === 1 && SKIP_TAGS.has(tag(node))) continue;
		if (!isBlock(node)) {
			inline.push(node);
			continue;
		}
		await flush();
		out.push(...(await block(node, hooks)));
	}
	await flush();
	return out;
}

async function block(node: DomNodeLike, hooks: DomConvertHooks): Promise<RootContent[]> {
	const name = tag(node);
	if (CONTAINER_TAGS.has(name)) return blocksOf(children(node), hooks);
	switch (name) {
		case "p": {
			const phrasing = trimPhrasing(await phrasingOf(children(node), hooks));
			return phrasing.length > 0 ? [{ type: "paragraph", children: phrasing }] : [];
		}
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6":
			return [{ type: "heading", depth: Number(name[1]) as 1, children: trimPhrasing(await phrasingOf(children(node), hooks)) }];
		case "ul":
		case "ol":
			return [await list(node, hooks)];
		case "table":
			return [await table(node, hooks)];
		case "pre": {
			const code = children(node).find((c) => tag(c) === "code");
			const lang = /(?:^|\s)language-(\S+)/.exec(attr(code ?? node, "class") ?? "")?.[1] ?? null;
			return [{ type: "code", lang, meta: null, value: (node.textContent ?? "").replace(/\n$/, "") }];
		}
		case "blockquote":
			return [{ type: "blockquote", children: (await blocksOf(children(node), hooks)) as BlockContent[] }];
		case "hr":
			return [{ type: "thematicBreak" }];
		default:
			return blocksOf(children(node), hooks);
	}
}

async function list(node: DomNodeLike, hooks: DomConvertHooks): Promise<List> {
	const items: ListItem[] = [];
	for (const li of children(node)) {
		if (tag(li) !== "li") continue;
		const box = findDescendant(li, (n) => tag(n) === "input" && (attr(n, "type") ?? "").toLowerCase() === "checkbox", (n) => tag(n) === "ul" || tag(n) === "ol");
		const dataTask = attr(li, "data-task");
		const checked = box ? attr(box, "checked") !== null || (dataTask !== null && dataTask !== "" && dataTask !== " ") : null;
		const content = await blocksOf(children(li), hooks);
		items.push({ type: "listItem", spread: false, checked, children: content as BlockContent[] });
	}
	const start = Number(attr(node, "start") ?? "1");
	return { type: "list", ordered: tag(node) === "ol", start: Number.isFinite(start) ? start : 1, spread: false, children: items };
}

async function table(node: DomNodeLike, hooks: DomConvertHooks): Promise<Table> {
	const rows: TableRow[] = [];
	const visit = async (n: DomNodeLike): Promise<void> => {
		for (const child of children(n)) {
			const name = tag(child);
			if (name === "tr") {
				const cells: TableCell[] = [];
				for (const cell of children(child)) {
					if (tag(cell) !== "td" && tag(cell) !== "th") continue;
					cells.push({ type: "tableCell", children: trimPhrasing(await cellPhrasing(cell, hooks)) });
				}
				rows.push({ type: "tableRow", children: cells });
			} else if (name === "thead" || name === "tbody" || name === "tfoot") await visit(child);
		}
	};
	await visit(node);
	const columns = Math.max(0, ...rows.map((r) => r.children.length));
	return { type: "table", align: Array<null>(columns).fill(null), children: rows };
}

/** 表のセルの中のブロック（リストなど）は、行ごとに改行でつないだインラインにする。 */
async function cellPhrasing(cell: DomNodeLike, hooks: DomConvertHooks): Promise<PhrasingContent[]> {
	const blocks = await blocksOf(children(cell), hooks);
	const out: PhrasingContent[] = [];
	const lines = blocks.flatMap((b) => blockLines(b));
	lines.forEach((line, i) => {
		if (i > 0) out.push({ type: "break" });
		out.push(...line);
	});
	return mergeTexts(out);
}

function blockLines(node: RootContent): PhrasingContent[][] {
	if (node.type === "paragraph" || node.type === "heading") return [node.children];
	if (node.type === "list") {
		return node.children.flatMap((item) => {
			const mark = item.checked === true ? "☑ " : item.checked === false ? "☐ " : node.ordered ? "" : "• ";
			const lines = item.children.flatMap((c) => blockLines(c as RootContent));
			if (lines.length === 0) return [];
			lines[0] = [{ type: "text", value: mark }, ...lines[0]];
			return lines;
		});
	}
	if (node.type === "code") return node.value.split("\n").map((v) => [{ type: "inlineCode", value: v }]);
	if ("children" in node) return (node.children as RootContent[]).flatMap(blockLines);
	return [];
}

async function phrasingOf(nodes: DomNodeLike[], hooks: DomConvertHooks): Promise<PhrasingContent[]> {
	const out: PhrasingContent[] = [];
	for (const node of nodes) out.push(...(await phrasing(node, hooks)));
	return mergeTexts(out);
}

async function phrasing(node: DomNodeLike, hooks: DomConvertHooks): Promise<PhrasingContent[]> {
	if (node.nodeType === 3) {
		const value = (node.textContent ?? "").replace(/\s+/g, " ");
		return value === "" ? [] : [{ type: "text", value }];
	}
	if (node.nodeType !== 1) return [];
	const name = tag(node);
	if (SKIP_TAGS.has(name)) return [];
	if (IMAGE_TAGS.has(name)) {
		const asset = await hooks.image(node).catch(() => null);
		const alt = attr(node, "alt") ?? attr(node, "aria-label") ?? name;
		if (!asset) return name === "img" && attr(node, "alt") ? [{ type: "text", value: alt }] : [];
		const image: EmbedImage = { type: "embedImage", path: "", alt, data: { image: asset } };
		return [image];
	}
	const inner = () => phrasingOf(children(node), hooks);
	switch (name) {
		case "br":
			return [{ type: "break" }];
		case "strong":
		case "b":
			return [{ type: "strong", children: await inner() }];
		case "em":
		case "i":
			return [{ type: "emphasis", children: await inner() }];
		case "del":
		case "s":
			return [{ type: "delete", children: await inner() }];
		case "code":
			return [{ type: "inlineCode", value: node.textContent ?? "" }];
		case "mark":
			return [{ type: "highlight", children: await inner() }];
		case "u":
		case "sup":
		case "sub":
			return [{ type: "htmlFormat", tag: name, children: await inner() }];
		case "a": {
			const content = await inner();
			const dataHref = attr(node, "data-href");
			const href = attr(node, "href") ?? "";
			const cls = attr(node, "class") ?? "";
			if (dataHref !== null || /\binternal-link\b/.test(cls)) {
				// 内部リンクは Wikilink と同じ解決にかける（A-18）
				const linkpath = dataHref ?? decodeSafe(href);
				const hash = linkpath.indexOf("#");
				const link: WikiLink = {
					type: "wikiLink",
					target: hash === -1 ? linkpath : linkpath.slice(0, hash),
					subpath: hash === -1 ? "" : linkpath.slice(hash),
					embed: false,
					raw: `[[${linkpath}]]`,
					children: content,
				};
				if (content.length === 0) link.children = [{ type: "text", value: wikiDisplay(link) }];
				return [link];
			}
			if (/^(https?:|mailto:)/i.test(href)) return [{ type: "link", url: href, title: null, children: content.length > 0 ? content : [{ type: "text", value: href }] }];
			return content;
		}
		default:
			// span などはそのまま中身だけ残す。ブロックの要素がインラインの位置にあるときも文字だけ残す
			return inner();
	}
}

function decodeSafe(href: string): string {
	try {
		return decodeURI(href);
	} catch {
		return href;
	}
}

function findDescendant(node: DomNodeLike, match: (n: DomNodeLike) => boolean, stop: (n: DomNodeLike) => boolean): DomNodeLike | null {
	for (const child of children(node)) {
		if (match(child)) return child;
		if (child.nodeType === 1 && !stop(child)) {
			const found = findDescendant(child, match, stop);
			if (found) return found;
		}
	}
	return null;
}

function mergeTexts(nodes: PhrasingContent[]): PhrasingContent[] {
	const out: PhrasingContent[] = [];
	for (const node of nodes) {
		const last = out[out.length - 1];
		if (node.type === "text" && last?.type === "text") last.value += node.value;
		else out.push(node);
	}
	return out;
}

/** 段落の前後の空白と改行を除く。 */
function trimPhrasing(nodes: PhrasingContent[]): PhrasingContent[] {
	const out = [...nodes];
	while (out.length > 0 && (out[0].type === "break" || (out[0].type === "text" && out[0].value.trim() === ""))) out.shift();
	while (out.length > 0 && (out[out.length - 1].type === "break" || (out[out.length - 1].type === "text" && (out[out.length - 1] as { value: string }).value.trim() === ""))) out.pop();
	const first = out[0];
	if (first?.type === "text") out[0] = { ...first, value: first.value.replace(/^\s+/, "") };
	const last = out[out.length - 1];
	if (last?.type === "text") out[out.length - 1] = { ...last, value: last.value.replace(/\s+$/, "") };
	return out;
}

export type { Paragraph };
