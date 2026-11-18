// 構文解析（parse）と変換（transform）の段（G2）。Obsidian API に依存しない。
// 構文解析: remark-parse + remark-gfm（表・取り消し線・タスク・URL の自動リンク・脚注）+ remark-frontmatter（YAML）。
// 変換: 処理の配列を順に適用する（H3 の拡張に備え、処理を 1 つずつ足せる形にする）。
import type { Code, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Warning } from "./types";

/** ハイライト `==…==`（A-13）を表す独自ノード。 */
export interface Highlight extends Parent {
	type: "highlight";
	children: PhrasingContent[];
}

declare module "mdast" {
	interface PhrasingContentMap {
		highlight: Highlight;
	}
	interface RootContentMap {
		highlight: Highlight;
	}
	interface Data {
		/** Mermaid の図のノート内の連番（1 から）。markMermaid が付ける */
		mermaidIndex?: number;
		/** 未対応の記法（A-0b）。markUnsupported が付ける */
		unsupported?: boolean;
		/** タスクの独自の状態の記号（A-4）。markTaskStates が付ける */
		taskSymbol?: string;
	}
}

export function parseMarkdown(markdown: string): Root {
	return unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).parse(markdown) as Root;
}

export interface TransformContext {
	warnings: Warning[];
}

export type Transform = (tree: Root, ctx: TransformContext) => void;

/** フェーズ 2 の変換の配列。順序に意味がある（未対応の印付けは最後）。 */
export const PHASE2_TRANSFORMS: readonly Transform[] = [markMermaid, markHighlight, markTaskStates, markUnsupported];

export function transformTree(tree: Root, transforms: readonly Transform[] = PHASE2_TRANSFORMS): TransformContext {
	const ctx: TransformContext = { warnings: [] };
	for (const transform of transforms) transform(tree, ctx);
	return ctx;
}

/** Mermaid のコードブロックを、文書の順に巡回する。取り出し（mermaid.ts）と連番付けで同じ順序を使う。 */
export function visitMermaidCodes(tree: Root, visit: (node: Code) => void): void {
	walk(tree, (node) => {
		if (node.type === "code" && (node as Code).lang?.toLowerCase() === "mermaid") visit(node as Code);
	});
}

/** Mermaid の図に連番を付ける（Mermaid ノードと画像の対応付け: フェーズ 2 の決定事項）。 */
export function markMermaid(tree: Root): void {
	let index = 0;
	visitMermaidCodes(tree, (node) => {
		node.data = { ...node.data, mermaidIndex: ++index };
	});
}

const HIGHLIGHT = /==(?=\S)(.+?)(?<=\S)==/g;

/** テキストの中の `==…==` をハイライトのノードにする（A-13）。1 つのテキストノードの中で閉じているものだけを扱う。 */
export function markHighlight(tree: Root): void {
	walkParents(tree, (parent) => {
		const next: RootContent[] = [];
		let changed = false;
		for (const child of parent.children as RootContent[]) {
			if (child.type !== "text" || !child.value.includes("==")) {
				next.push(child);
				continue;
			}
			let last = 0;
			const value = (child as Text).value;
			for (const m of value.matchAll(HIGHLIGHT)) {
				changed = true;
				if (m.index! > last) next.push({ type: "text", value: value.slice(last, m.index) });
				next.push({ type: "highlight", children: [{ type: "text", value: m[1]! }] } as unknown as RootContent);
				last = m.index! + m[0].length;
			}
			if (last === 0) next.push(child);
			else if (last < value.length) next.push({ type: "text", value: value.slice(last) });
		}
		if (changed) (parent as Parent).children = next as Parent["children"];
	});
}

/** タスクの独自の状態の対応表（A-4・フェーズ 2 の決定事項）。 */
export const TASK_SYMBOLS: Readonly<Record<string, string>> = { "/": "◐", "-": "☒", ">": "➔" };

/** `- [/] 文` のような独自の状態を記号にする。remark-gfm は `[ ]` と `[x]` だけをタスクとして解釈する。 */
export function markTaskStates(tree: Root): void {
	walk(tree, (node) => {
		if (node.type !== "listItem" || node.checked !== null && node.checked !== undefined) return;
		const first = node.children[0];
		if (first?.type !== "paragraph") return;
		const text = first.children[0];
		if (text?.type !== "text") return;
		const m = /^\[(.)\] /.exec(text.value);
		const symbol = m ? TASK_SYMBOLS[m[1]!] : undefined;
		if (!m || !symbol) return;
		text.value = text.value.slice(m[0].length);
		node.data = { ...node.data, taskSymbol: symbol };
	});
}

/** .docx にしない記法（A-0b）。フェーズ 3a で画像・HTML・脚注・参照形式のリンクに対応した（obsidian-syntax.ts）。数式は 3b。 */
const UNSUPPORTED = new Set(["imageReference", "linkReference", "definition", "math", "inlineMath"]);

/** 未対応の記法に印を付け、種類ごとに 1 つ警告を出す（A-0b）。 */
export function markUnsupported(tree: Root, ctx: TransformContext): void {
	const seen = new Set<string>();
	walk(tree, (node) => {
		if (!UNSUPPORTED.has(node.type)) return;
		node.data = { ...node.data, unsupported: true };
		if (!seen.has(node.type)) {
			seen.add(node.type);
			ctx.warnings.push({ code: "unsupportedSyntax", detail: node.type });
		}
	});
}

export type AnyNode = Root | RootContent;

/** 木を深さ優先で巡回する（親を先に訪れる）。 */
export function walk(node: AnyNode, visit: (node: RootContent) => void): void {
	if (node.type !== "root") visit(node);
	if ("children" in node) for (const child of node.children as RootContent[]) walk(child, visit);
}

/** 子を持つノードを深さ優先で巡回する。visit の中で子を差し替えてよい（差し替えた後の子を巡回する）。 */
export function walkParents(node: AnyNode, visit: (parent: Parent) => void): void {
	if ("children" in node) {
		visit(node as Parent);
		for (const child of node.children as RootContent[]) walkParents(child, visit);
	}
}
