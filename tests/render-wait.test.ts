import { describe, expect, it } from "vitest";
import { FIRST_CHANGE_MS, STATIC_FIRST_CHANGE_MS, mayRenderLater, noteTiming } from "../src/core/render-wait";

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
