import { describe, expect, it } from "vitest";
import { FIRST_CHANGE_MS, STATIC_FIRST_CHANGE_MS, mayRenderLater, mayRenderLaterDeep, noteTiming, type EmbedReader } from "../src/core/render-wait";

const dataviewOnly = (lang: string) => lang === "dataview" || lang === "dataviewjs";

describe("非同期に描かれうるものの判定（描画の完了待ち）", () => {
	it("他のプラグインのコードブロックがあれば true", () => {
		expect(mayRenderLater("# 見出し\n\n```dataview\nLIST\n```\n", dataviewOnly)).toBe(true);
		expect(mayRenderLater("~~~dataviewjs\ndv.list([1])\n~~~\n", dataviewOnly)).toBe(true);
	});

	it("描画の処理が登録されていない言語のコードブロックだけなら false", () => {
		expect(mayRenderLater("```ts\nconst a = 1;\n```\n\n```mermaid\nflowchart LR\n  A-->B\n```\n", dataviewOnly)).toBe(false);
	});

	it("ノートの埋め込みは true、画像などの添付ファイルの埋め込みは false", () => {
		expect(mayRenderLater("![[別のノート]]", dataviewOnly)).toBe(true);
		expect(mayRenderLater("![[別のノート#見出し|別名]]", dataviewOnly)).toBe(true);
		expect(mayRenderLater("![[image.png|200]] ![[資料.pdf]]", dataviewOnly)).toBe(false);
	});

	it("Dataview のインラインクエリは true", () => {
		expect(mayRenderLater("名前: `= this.file.name`", dataviewOnly)).toBe(true);
		expect(mayRenderLater("件数: `$= dv.pages().length`", dataviewOnly)).toBe(true);
		expect(mayRenderLater("ふつうの `code`", dataviewOnly)).toBe(false);
	});

	it("非同期に描くものがなければ、最初の変化を待つ時間を短くする", () => {
		expect(noteTiming("本文だけ", dataviewOnly).firstChangeMs).toBe(STATIC_FIRST_CHANGE_MS);
		expect(noteTiming("![[別のノート]]", dataviewOnly).firstChangeMs).toBe(FIRST_CHANGE_MS);
	});
});

describe("埋め込みをたどる判定", () => {
	const notes: Record<string, string> = {
		"静的.md": "本文だけ ![[画像.png]]",
		"クエリ.md": "```dataview\nLIST\n```",
		"中継.md": "![[クエリ]]",
		"循環A.md": "![[循環B]]",
		"循環B.md": "![[循環A]]",
	};
	const read: EmbedReader = async (link) => {
		if (link.endsWith(".canvas")) return "other";
		const path = `${link}.md`;
		return path in notes ? { path, markdown: notes[path] } : "missing";
	};
	const check = (markdown: string) => mayRenderLaterDeep("元.md", markdown, dataviewOnly, read);

	it("埋め込んだノートが静的なら false", async () => {
		expect(await check("![[静的]]")).toBe(false);
	});

	it("埋め込んだノート（入れ子を含む）にプラグインのコードブロックがあれば true", async () => {
		expect(await check("![[クエリ]]")).toBe(true);
		expect(await check("![[中継]]")).toBe(true);
	});

	it("解決できない埋め込みは false、ノート以外の埋め込みは true", async () => {
		expect(await check("![[ない]]")).toBe(false);
		expect(await check("![[図.canvas]]")).toBe(true);
	});

	it("循環した埋め込みでも止まる", async () => {
		expect(await check("![[循環A]]")).toBe(false);
	});
});
