import { describe, expect, it } from "vitest";
import { collectCssVariables, resolveCssVariables } from "../src/core/svg-css";

// いまの Obsidian の Mermaid が出す SVG の形（色を CSS 変数で指定する）
const MERMAID_LIKE =
	'<svg xmlns="http://www.w3.org/2000/svg" fill="var(--_fg)"><g style=";--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);--_l:var(--pele-line,#1f1f1f);color:var(--_fg);font-family:var(--pele-font,&quot;Yu Gothic&quot;, sans-serif)" fill="var(--_fg)">' +
	'<path stroke="var(--_l)" fill="var(--_s, #f3f3f3)"/><rect style="fill: var(--_bg); stroke: var(--undefined)"/></g></svg>';

describe("SVG の CSS 変数の置き換え（Word で図が黒くなる不具合）", () => {
	it("宣言を集める", () => {
		const defs = collectCssVariables(MERMAID_LIKE);
		expect(defs.get("_fg")).toBe("var(--pele-fg,#1f1f1f)");
		expect(defs.get("_bg")).toBe("var(--pele-bg,#fff)");
	});

	it("入れ子の var() を、宣言の値か既定値に置き換える", () => {
		const out = resolveCssVariables(MERMAID_LIKE);
		expect(out).not.toContain("var(");
		expect(out).toContain('fill="#1f1f1f"');
		expect(out).toContain('stroke="#1f1f1f"');
		expect(out).toContain('fill="#f3f3f3"');
		expect(out).toContain("fill: #fff");
		expect(out).toContain("font-family:&quot;Yu Gothic&quot;, sans-serif");
		// 宣言も既定値もないものは空
		expect(out).toContain('stroke: "');
	});

	it("currentColor は文字色（color:）に、なければ黒にする", () => {
		expect(resolveCssVariables('<svg><g style="color:var(--c,#123456)"><path fill="currentColor"/></g></svg>')).toContain('fill="#123456"');
		expect(resolveCssVariables('<svg><path stroke="currentColor"/></svg>')).toContain('stroke="#000000"');
	});

	it("var() がなければそのまま。自分自身を参照する宣言では無限に置き換えない", () => {
		expect(resolveCssVariables('<svg fill="red"/>')).toBe('<svg fill="red"/>');
		expect(resolveCssVariables('<svg style="--a:var(--a, blue)" fill="var(--a)"/>')).toContain('fill="blue"');
	});
});
