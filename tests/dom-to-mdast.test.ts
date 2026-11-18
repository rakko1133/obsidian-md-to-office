import { describe, expect, it } from "vitest";
import { domToMdast, type DomNodeLike } from "../src/core/dom-to-mdast";

// 偽の DOM: 要素とテキストだけを持つ
function el(tagName: string, attrs: Record<string, string> = {}, ...childNodes: (DomNodeLike | string)[]): DomNodeLike {
	const kids = childNodes.map((c) => (typeof c === "string" ? txt(c) : c));
	return {
		nodeType: 1,
		tagName: tagName.toUpperCase(),
		childNodes: kids,
		getAttribute: (name) => attrs[name] ?? null,
		get textContent() {
			return kids.map((k) => k.textContent ?? "").join("");
		},
	};
}
const txt = (value: string): DomNodeLike => ({ nodeType: 3, textContent: value, childNodes: [] });

const PNG = { type: "png" as const, data: new Uint8Array([1]), width: 10, height: 10 };
const hooks = { image: async (node: DomNodeLike) => (node.tagName === "CANVAS" || node.tagName === "SVG" ? PNG : null) };
const convert = (...children: DomNodeLike[]) => domToMdast(el("div", {}, ...children), hooks);

describe("描画結果の DOM → mdast（フェーズ 3b）", () => {
	it("Dataview の表: 見出し行と本文の行、内部リンクは Wikilink にする", async () => {
		const table = el(
			"table",
			{ class: "dataview table-view-table" },
			el("thead", {}, el("tr", {}, el("th", {}, el("span", {}, "File")), el("th", {}, "status"))),
			el("tbody", {}, el("tr", {}, el("td", {}, el("a", { class: "internal-link", "data-href": "data/データ A.md", href: "data/データ A.md" }, "データ A")), el("td", {}, "draft"))),
		);
		const [node] = await convert(el("div", { class: "block-language-dataview" }, table));
		expect(node).toMatchObject({
			type: "table",
			children: [
				{ children: [{ children: [{ type: "text", value: "File" }] }, { children: [{ type: "text", value: "status" }] }] },
				{ children: [{ children: [{ type: "wikiLink", target: "data/データ A.md", subpath: "", children: [{ type: "text", value: "データ A" }] }] }, {}] },
			],
		});
	});

	it("タスクのリスト: チェックボックスの状態を checked にする", async () => {
		const ul = el(
			"ul",
			{ class: "contains-task-list" },
			el("li", { class: "task-list-item", "data-task": "" }, el("input", { type: "checkbox" }), " 未完了"),
			el("li", { class: "task-list-item", "data-task": "x" }, el("input", { type: "checkbox", checked: "" }), " 完了"),
		);
		const [list] = await convert(ul);
		expect(list).toMatchObject({ type: "list", ordered: false, children: [{ checked: false }, { checked: true }] });
		expect(list).toMatchObject({ children: [{ children: [{ type: "paragraph", children: [{ type: "text", value: "未完了" }] }] }, {}] });
	});

	it("見出し・段落・強調・外部リンク・コード。インラインの要素の並びは段落にまとめる", async () => {
		const out = await convert(el("h3", {}, "見出し"), txt(" 前の文 "), el("strong", {}, "太字"), el("a", { href: "https://example.com" }, "外部"), el("pre", {}, el("code", { class: "language-js" }, "x = 1\n")));
		expect(out.map((n) => n.type)).toEqual(["heading", "paragraph", "code"]);
		expect(out[0]).toMatchObject({ depth: 3 });
		expect(out[1]).toMatchObject({ children: [{ type: "text", value: "前の文 " }, { type: "strong" }, { type: "link", url: "https://example.com" }] });
		expect(out[2]).toMatchObject({ lang: "js", value: "x = 1" });
	});

	it("svg と canvas は画像、script とボタンは除く、span は中身だけ", async () => {
		const out = await convert(el("p", {}, el("span", {}, "a"), el("canvas"), el("button", {}, "copy"), el("script", {}, "x")), el("svg"));
		expect(out).toHaveLength(2);
		expect(out[0]).toMatchObject({ type: "paragraph", children: [{ type: "text", value: "a" }, { type: "embedImage", data: { image: PNG } }] });
		expect(out[1]).toMatchObject({ type: "paragraph", children: [{ type: "embedImage" }] });
	});

	it("表のセルの中のリストは、改行でつないだ文字にする", async () => {
		const table = el("table", {}, el("tr", {}, el("td", {}, el("ul", {}, el("li", {}, "x"), el("li", {}, "y")))));
		const [node] = await convert(table);
		expect(node).toMatchObject({ children: [{ children: [{ children: [{ value: "• x" }, { type: "break" }, { value: "• y" }] }] }] });
	});
});
