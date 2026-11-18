import { describe, expect, it } from "vitest";
import { buildRenderSource, diagramHash, extractMermaidBlocks, imageFileName, type MermaidRenderParams } from "../src/core/mermaid";

const params: MermaidRenderParams = { theme: "neutral", fontFamily: "Meiryo", dpi: 192, transparentBackground: false };

describe("extractMermaidBlocks", () => {
	it("Mermaid のコードブロックだけを、出てくる順に連番を付けて取り出す", () => {
		const md = [
			"# 見出し",
			"```mermaid",
			"flowchart TD",
			"  A --> B",
			"```",
			"```js",
			"const x = 1;",
			"```",
			"> 引用の中",
			"> ```mermaid",
			"> pie",
			'>   "a" : 1',
			"> ```",
			"~~~Mermaid",
			"sequenceDiagram",
			"~~~",
		].join("\n");
		const blocks = extractMermaidBlocks(md);
		expect(blocks.map((b) => b.index)).toEqual([1, 2, 3]);
		expect(blocks[0]!.source).toBe("flowchart TD\n  A --> B");
		expect(blocks[1]!.source.startsWith("pie")).toBe(true);
		expect(blocks[2]!.source).toBe("sequenceDiagram");
	});

	it("4 つの ` で囲んだ中の ``` は図として数えない", () => {
		const md = "````md\n```mermaid\nflowchart TD\n```\n````";
		expect(extractMermaidBlocks(md)).toEqual([]);
	});
});

describe("buildRenderSource", () => {
	it("先頭にプラグインのディレクティブを足す", () => {
		const out = buildRenderSource("flowchart TD\n  A", params);
		expect(out.split("\n")[0]).toMatch(/^%%\{init: .*"theme":"neutral".*\}%%$/);
		expect(out.split("\n")[1]).toBe("flowchart TD");
	});

	it("利用者のディレクティブは残し、その後ろに置いて上書きする", () => {
		const out = buildRenderSource("%%{init: {'theme':'dark','sequence':{'mirrorActors':false}}}%%\nsequenceDiagram", params).split("\n");
		expect(out[0]).toContain("'dark'");
		expect(out[1]).toContain('"neutral"');
		expect(out[2]).toBe("sequenceDiagram");
	});

	it("frontmatter は先頭のまま残す", () => {
		const out = buildRenderSource("---\ntitle: T\n---\nflowchart TD", params).split("\n");
		expect(out.slice(0, 3)).toEqual(["---", "title: T", "---"]);
		expect(out[3]).toMatch(/^%%\{init:/);
	});
});

describe("diagramHash と imageFileName", () => {
	it("ソース・設定・バージョンのどれかが変わるとハッシュが変わる", async () => {
		const h = await diagramHash("flowchart TD", params, "11.0.0");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(await diagramHash("flowchart TD", params, "11.0.0")).toBe(h);
		expect(await diagramHash("flowchart LR", params, "11.0.0")).not.toBe(h);
		expect(await diagramHash("flowchart TD", { ...params, dpi: 300 }, "11.0.0")).not.toBe(h);
		expect(await diagramHash("flowchart TD", params, "11.1.0")).not.toBe(h);
	});

	it("命名規則 {ノート名}_mermaid_{連番2桁}_{ハッシュ8桁}.{拡張子}", () => {
		expect(imageFileName("設計", 3, "0123456789abcdef", "png")).toBe("設計_mermaid_03_01234567.png");
	});
});
