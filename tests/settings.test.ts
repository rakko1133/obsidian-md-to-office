import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeFolderPath, normalizeSettings } from "../src/core/settings";

describe("normalizeSettings", () => {
	it("data.json がない（undefined）ときは既定値を返す", () => {
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
	});

	it("壊れた値は既定値に戻す", () => {
		expect(normalizeSettings({ outputRoot: 42 })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings("broken")).toEqual(DEFAULT_SETTINGS);
	});

	it("保存された値を使う", () => {
		expect(normalizeSettings({ outputRoot: "out/docs" }).outputRoot).toBe("out/docs");
	});
});

describe("normalizeFolderPath", () => {
	it("前後の空白・スラッシュを除き、バックスラッシュをスラッシュにする", () => {
		expect(normalizeFolderPath(String.raw`  /out\docs/ `, "_export")).toBe("out/docs");
	});

	it("空なら既定値にする", () => {
		expect(normalizeFolderPath(" / ", "_export")).toBe("_export");
	});
});
