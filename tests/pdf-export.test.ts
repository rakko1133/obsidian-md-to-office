import { describe, expect, it } from "vitest";
import { headingKey, headingOfSubpath, pdfConvertedNotes, pdfOutputRef, pdfPageOptions, pdfRelativePath, pdfTargetRef, planPdfNote } from "../src/core/pdf-export";
import { mergeAllResults } from "../src/core/run";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/core/settings";
import type { NoteResult } from "../src/core/types";

const settings = DEFAULT_SETTINGS;

describe("PDF の出力先（H1-PDF）", () => {
	it("1 ノート = 1 PDF はミラー出力の {ノート名}.pdf", () => {
		expect(pdfOutputRef("a/b/ノート.md", settings)).toEqual({ location: "vault", path: "_export/a/b/ノート.pdf" });
		expect(pdfOutputRef("a/ノート.md", { ...settings, saveMode: "sameFolder" })).toEqual({ location: "vault", path: "a/ノート.pdf" });
	});

	it("結合出力では、今回の対象のノートはフォルダの PDF、対象外はノートの PDF", () => {
		const options = { combine: true, vaultName: "V", selected: new Set(["a/x.md"]) };
		expect(pdfTargetRef("a/x.md", settings, options)).toEqual({ location: "vault", path: "_export/a/a.pdf" });
		expect(pdfTargetRef("b/y.md", settings, options)).toEqual({ location: "vault", path: "_export/b/y.pdf" });
		expect(pdfTargetRef("top.md", settings, { ...options, selected: new Set(["top.md"]) })).toEqual({ location: "vault", path: "_export/V.pdf" });
	});

	it("ドライラン: 同名ファイルの設定で予定動作が決まる", async () => {
		const plans = await planPdfNote("a/x.md", { ...settings, onConflict: "rename" }, false, "V", () => Promise.resolve(true));
		expect(plans).toEqual([{ output: { location: "vault", path: "_export/a/x.pdf" }, action: "rename" }]);
	});

	it("変換対象: 今回の対象と、記録に PDF として残るノート（Word の記録は数えない）", () => {
		const manifest = {
			entries: [
				{ output: { location: "vault" as const, path: "_export/p.pdf" }, sources: ["p.md"], kind: "pdf" as const, contentHash: "", writtenAt: "" },
				{ output: { location: "vault" as const, path: "_export/w.docx" }, sources: ["w.md"], kind: "docx" as const, contentHash: "", writtenAt: "" },
			],
		};
		expect([...pdfConvertedNotes(["a.md"], manifest)].sort()).toEqual(["a.md", "p.md"]);
	});

	it("別の PDF への相対パスは符号化しない（日本語・空白をそのまま）", () => {
		expect(pdfRelativePath({ location: "vault", path: "_export/a/x.pdf" }, { location: "vault", path: "_export/b c/データ A.pdf" })).toBe("../b c/データ A.pdf");
		expect(pdfRelativePath({ location: "vault", path: "x.pdf" }, { location: "external", path: "y.pdf" })).toBeNull();
	});
});

describe("PDF のページ設定", () => {
	it("用紙はインチ、向きは landscape、拡大率は 0.1〜2", () => {
		const page = pdfPageOptions({ pdfPaperSize: "B5", pdfOrientation: "landscape", pdfMarginsMm: { top: 25.4, bottom: 0, left: 12.7, right: 50.8 }, pdfScale: 150 });
		expect(page.pageSize.width).toBeCloseTo(182 / 25.4);
		expect(page.pageSize.height).toBeCloseTo(257 / 25.4);
		expect(page.landscape).toBe(true);
		expect(page.scale).toBe(1.5);
		expect(page.margins).toEqual({ top: 1, bottom: 0, left: 0.5, right: 2 });
	});
});

describe("リンクの部分パス", () => {
	it("見出しは最後の要素、ブロック ID と空は null", () => {
		expect(headingOfSubpath("#見出し")).toBe("見出し");
		expect(headingOfSubpath("#親#子")).toBe("子");
		expect(headingOfSubpath("#^abc")).toBeNull();
		expect(headingOfSubpath("")).toBeNull();
		expect(headingKey("  Foo   Bar ")).toBe(headingKey("foo bar"));
	});
});

describe("設定（H1-PDF）", () => {
	it("1.0 までの defaultFormat を defaultFormats に移す", () => {
		expect(normalizeSettings({ defaultFormat: "both" }).defaultFormats).toEqual(["word", "excel"]);
		expect(normalizeSettings({ defaultFormat: "excel" }).defaultFormats).toEqual(["excel"]);
		expect(normalizeSettings({}).defaultFormats).toEqual(["word"]);
	});

	it("defaultFormats は表示順にそろえ、不明な値を除き、空なら既定値", () => {
		expect(normalizeSettings({ defaultFormats: ["pdf", "word", "pdf", "x"] }).defaultFormats).toEqual(["word", "pdf"]);
		expect(normalizeSettings({ defaultFormats: [] }).defaultFormats).toEqual(["word"]);
	});

	it("PDF のページ設定の範囲外は既定値に戻す", () => {
		const s = normalizeSettings({ pdfPaperSize: "A0", pdfScale: 500, pdfMarginsMm: { top: -1 } });
		expect(s.pdfPaperSize).toBe("A4");
		expect(s.pdfScale).toBe(100);
		expect(s.pdfMarginsMm.top).toBe(25);
		expect(normalizeSettings({ pdfPaperSize: "A3", pdfScale: 80 })).toMatchObject({ pdfPaperSize: "A3", pdfScale: 80 });
	});
});

describe("3 つ以上の形式の結果をまとめる", () => {
	const result = (status: NoteResult["status"], kind: "docx" | "xlsx" | "pdf" | null): NoteResult => ({
		notePath: "a.md",
		status,
		files: kind ? [{ output: { location: "vault", path: `a.${kind}` }, kind, status: status === "failed" ? "failed" : "success" }] : [],
		warnings: [],
		deleted: [],
	});

	it("出力がまとまり、表のないノートの Excel のスキップは全体のスキップにしない", () => {
		const merged = mergeAllResults([result("success", "docx"), result("skipped", null), result("success", "pdf")]);
		expect(merged.status).toBe("success");
		expect(merged.files.map((f) => f.kind)).toEqual(["docx", "pdf"]);
	});

	it("どれか 1 つが失敗なら失敗", () => {
		expect(mergeAllResults([result("success", "docx"), result("failed", "pdf")]).status).toBe("failed");
	});
});
