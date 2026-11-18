// アウトライン形式の行を作る（A-30 のオプション・フェーズ 4b）。Obsidian API にも exceljs にも依存しない。
// 見出しの階層を列「H1・H2・H3・本文」にし、1 段落 / 1 リスト項目 = 1 行にする。表は本文の列から右へそのまま並べる。
import type { BlockContent, List, PhrasingContent, Root, RootContent } from "mdast";
import { tablesOf, type XlsxTable } from "./xlsx-render";

/** アウトライン形式の 1 行（表は 1 つで複数行）。level は行のグループ化の段（0 = グループにしない）。 */
export type OutlineRow =
	| { kind: "heading"; depth: number; content: PhrasingContent[]; level: number }
	| { kind: "text"; content: PhrasingContent[]; level: number; bold?: boolean }
	| { kind: "code"; text: string; level: number }
	| { kind: "table"; table: XlsxTable; level: number };

const CHECKED = "☑";
const UNCHECKED = "☐";
const INDENT = "  ";

/** ノートの本文をアウトライン形式の行にする。 */
export function outlineRows(tree: Root): OutlineRow[] {
	const rows: OutlineRow[] = [];
	/** いまの見出しの段（H1 の下 = 1、H2 の下 = 2、H3 以下の下 = 3） */
	let level = 0;

	const text = (value: string): PhrasingContent => ({ type: "text", value });

	const blocks = (nodes: readonly RootContent[]): void => {
		for (const node of nodes) block(node);
	};

	const block = (node: RootContent): void => {
		switch (node.type) {
			case "heading": {
				const depth = node.depth;
				// 見出しの行自身は、ひとつ上の段のグループに入る（H1 の行はグループにしない）。H4〜H6 は H3 の下の段
				rows.push({ kind: "heading", depth, content: withoutImages(node.children), level: depth <= 3 ? depth - 1 : 3 });
				level = Math.min(depth, 3);
				break;
			}
			case "paragraph":
				rows.push({ kind: "text", content: withoutImages(node.children), level });
				break;
			case "list":
				list(node, 0);
				break;
			case "code":
				rows.push({ kind: "code", text: node.value, level });
				break;
			case "math":
				rows.push({ kind: "text", content: [text(node.value)], level });
				break;
			case "table": {
				const [table] = tablesOf({ type: "root", children: [node] });
				if (table) rows.push({ kind: "table", table, level });
				break;
			}
			case "blockquote":
				blocks(node.children);
				break;
			case "callout":
				if (node.title.length > 0) rows.push({ kind: "text", content: withoutImages(node.title), level, bold: true });
				blocks(node.children as RootContent[]);
				break;
			default:
				// 水平線・HTML・改ページ・脚注の定義などは出さない
				break;
		}
	};

	const list = (node: List, depth: number): void => {
		node.children.forEach((item, i) => {
			const marker = item.checked === true ? `${CHECKED} ` : item.checked === false ? `${UNCHECKED} ` : node.ordered ? `${(node.start ?? 1) + i}. ` : "";
			const [first, ...rest] = item.children;
			const prefix = text(INDENT.repeat(depth) + marker);
			if (first?.type === "paragraph") {
				// 独自の状態のタスク（`[/]` など）は、構文解析の段階で記号に置き換わっている（A-4）
				rows.push({ kind: "text", content: [prefix, ...withoutImages(first.children)], level });
			} else {
				rows.push({ kind: "text", content: [prefix], level });
				if (first) child(first, depth);
			}
			for (const c of rest) child(c, depth);
		});
	};

	const child = (node: BlockContent | RootContent, depth: number): void => {
		if (node.type === "list") list(node, depth + 1);
		else block(node as RootContent);
	};

	blocks(tree.children);
	return rows;
}

/** 画像はアウトライン形式では置かないので、代替テキストにする（A-33）。 */
function withoutImages(nodes: readonly PhrasingContent[]): PhrasingContent[] {
	return nodes.map((node) => {
		if (node.type === "embedImage") return { type: "text", value: node.alt || node.path };
		if (node.type === "image") return { type: "text", value: node.alt ?? "" };
		if ("children" in node && Array.isArray(node.children)) return { ...node, children: withoutImages(node.children as PhrasingContent[]) } as PhrasingContent;
		return node;
	});
}
