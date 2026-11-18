import { describe, expect, it } from "vitest";
import { cssColorToHex } from "../src/core/css-color";

// テーマのコールアウトの色（A-6 のオプション）。Obsidian 1.15 の --callout-color は色そのもの、古いテーマは "r, g, b"
describe("CSS の色 → Word の色", () => {
	it.each([
		["8, 109, 221", "086DDD"],
		["#086ddd", "086DDD"],
		["#08d", "0088DD"],
		["#086ddd80", "086DDD"],
		["rgb(8, 109, 221)", "086DDD"],
		["rgba(8, 109, 221, 0.5)", "086DDD"],
		["rgb(8 109 221 / 50%)", "086DDD"],
		["rgb(100%, 0%, 50%)", "FF0080"],
		["color(srgb 1 0.5 0)", "FF8000"],
		["  #FFFFFF ", "FFFFFF"],
	])("%s → %s", (value, expected) => {
		expect(cssColorToHex(value)).toBe(expected);
	});

	it.each(["", "var(--color-blue)", "color-mix(in oklch, red 10%, transparent)", "blue", "rgba(0, 0, 0, 0)", "1, 2"])("%s は読めない（undefined）", (value) => {
		expect(cssColorToHex(value)).toBeUndefined();
	});
});
