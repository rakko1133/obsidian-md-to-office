import { build } from "esbuild";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { texToSvg } from "../src/core/math-svg";

// Word の数式（latexToMath）にできない式を、同梱の MathJax で SVG にする（A-11 の代替）
describe("数式の SVG 化（同梱の MathJax）", () => {
	it.each([String.raw`\sideset{_1^2}{_3^4}\sum_{k} a_k`, String.raw`\genfrac{(}{)}{0pt}{}{n}{k}`, String.raw`\ce{H2O}`, String.raw`\bbox[5px]{x}`])("%s を SVG にできる", (latex) => {
		const { svg, width, height } = texToSvg(latex, true);
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect(width).toBeGreaterThan(0);
		expect(height).toBeGreaterThan(0);
		// 大きさは px、字形は <use> で参照せずパスを直接書く、色は Word が読める値
		expect(svg).toContain(` width="${width}"`);
		expect(svg).not.toMatch(/="[\d.]+ex"/);
		expect(svg).not.toContain("<use");
		expect(svg).toContain("<path");
		expect(svg).not.toContain("currentColor");
		expect(svg).not.toContain("style=");
	});

	it("MathJax が読めない式は例外（呼び出し側で LaTeX のまま残す）", () => {
		expect(() => texToSvg(String.raw`\undefinedcommand{x}`, true)).toThrow();
		expect(() => texToSvg(String.raw`\frac{1}{`, true)).toThrow();
	});

	it("インラインの式は別表示の式より小さい", () => {
		expect(texToSvg(String.raw`\sum_{k=1}^n k`, false).height).toBeLessThan(texToSvg(String.raw`\sum_{k=1}^n k`, true).height);
	});
});

describe("Obsidian のグローバルの MathJax との共存", () => {
	// Obsidian には同梱の MathJax（CHTML 版）がグローバルにあり、loader に preLoad がない。
	// MathJax の AllPackages.js はグローバルの MathJax を見て preLoad を呼ぶため、プラグインの読み込みが失敗した。
	// node_modules のモジュールは Node の require のキャッシュに残るので、esbuild で main.js と同じようにバンドルして別の文脈で実行する
	it("グローバルに MathJax（loader に preLoad がない）があっても読み込めて、SVG を作れる", async () => {
		const result = await build({ entryPoints: ["src/core/math-svg.ts"], bundle: true, format: "cjs", platform: "browser", write: false, logLevel: "silent" });
		const code = result.outputFiles[0]!.text;
		const module = { exports: {} as { texToSvg?: (latex: string, display: boolean) => { svg: string } } };
		const context = createContext({ module, exports: module.exports, MathJax: { loader: {}, tex2chtml: () => null }, console });
		runInContext(code, context);
		expect(module.exports.texToSvg!("x^2", false).svg).toContain("<svg");
	});
});
