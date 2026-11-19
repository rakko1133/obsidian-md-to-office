import { describe, expect, it } from "vitest";
import {
	MIN_TABLE_ZOOM,
	headingKey,
	headingOfSubpath,
	pdfConvertedNotes,
	pdfOutputRef,
	pdfPageOptions,
	pdfPrintableHeightPx,
	pdfPrintableWidthPx,
	pdfRelativePath,
	pdfTargetRef,
	pdfTextCssProps,
	planPdfNote,
	tableZoom,
} from "../src/core/pdf-export";
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

describe("画像・図の最大の高さ", () => {
	const margins = { top: 25, bottom: 25, left: 20, right: 20 };
	const base = { pdfPaperSize: "A4" as const, pdfOrientation: "portrait" as const, pdfMarginsMm: margins, pdfScale: 100 };

	it("印字領域の高さ（CSS px）の 85%", () => {
		// A4 縦: (297 - 50) mm = 247 mm → 247 / 25.4 × 96 ≒ 933.5 px
		expect(pdfPrintableHeightPx(pdfPageOptions(base))).toBe(Math.floor(((247 / 25.4) * 96) * 0.85));
	});

	it("横向きは用紙の幅、拡大率で割る", () => {
		const landscape = pdfPrintableHeightPx(pdfPageOptions({ ...base, pdfOrientation: "landscape" }));
		expect(landscape).toBe(Math.floor(((160 / 25.4) * 96) * 0.85));
		const half = pdfPrintableHeightPx(pdfPageOptions({ ...base, pdfScale: 50 }));
		expect(half).toBe(Math.floor(((247 / 25.4) * 96 * 2) * 0.85));
	});
});

describe("印字領域の幅と表の縮小（読みやすさ）", () => {
	const margins = { top: 25, bottom: 25, left: 20, right: 20 };
	const base = { pdfPaperSize: "A4" as const, pdfOrientation: "portrait" as const, pdfMarginsMm: margins, pdfScale: 100 };

	it("印字領域の幅（CSS px）は用紙の幅から左右の余白を引く。横向きは用紙の高さ、拡大率で割る", () => {
		expect(pdfPrintableWidthPx(pdfPageOptions(base))).toBe(Math.floor((170 / 25.4) * 96));
		expect(pdfPrintableWidthPx(pdfPageOptions({ ...base, pdfOrientation: "landscape" }))).toBe(Math.floor((257 / 25.4) * 96));
		expect(pdfPrintableWidthPx(pdfPageOptions({ ...base, pdfScale: 50 }))).toBe(Math.floor((170 / 25.4) * 96 * 2));
	});

	it("収まる表は縮小しない。収まらない表は収まる倍率にし、MIN_TABLE_ZOOM より小さくしない", () => {
		expect(tableZoom(600, 600)).toBe(1);
		expect(tableZoom(600.5, 600)).toBe(1);
		expect(tableZoom(800, 600)).toBe(0.75);
		expect(tableZoom(5000, 600)).toBe(MIN_TABLE_ZOOM);
		expect(tableZoom(800, 0)).toBe(1);
	});
});

describe("本文の文字の CSS の変数", () => {
	it("大きさは pt を px にし、フォントは本文とコードの両方に入れる", () => {
		expect(pdfTextCssProps({ pdfFontFamily: '"BIZ UDPGothic", sans-serif', pdfCodeFontFamily: "Consolas", pdfFontSizePt: 10.5 })).toEqual({
			"--batch-office-export-pdf-font-size": "14px",
			"--font-text-size": "14px",
			"--batch-office-export-pdf-font": '"BIZ UDPGothic", sans-serif',
			"--font-text": '"BIZ UDPGothic", sans-serif',
			"--batch-office-export-pdf-code-font": "Consolas",
			"--font-monospace": "Consolas",
		});
	});

	it("フォントが空なら Obsidian のフォントのまま（変数を入れない）", () => {
		expect(pdfTextCssProps({ pdfFontFamily: "", pdfCodeFontFamily: "", pdfFontSizePt: 9 })).toEqual({
			"--batch-office-export-pdf-font-size": "12px",
			"--font-text-size": "12px",
		});
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

	it("PDF の文字: 大きさは 6〜24 の 0.5 刻み、フォントは前後の空白を除き、空も受け付ける", () => {
		expect(normalizeSettings({})).toMatchObject({ pdfFontSizePt: 10.5 });
		expect(normalizeSettings({}).pdfFontFamily).toContain("BIZ UDPGothic");
		expect(normalizeSettings({}).pdfCodeFontFamily).toContain("BIZ UDGothic");
		expect(normalizeSettings({ pdfFontSizePt: 12.5 }).pdfFontSizePt).toBe(12.5);
		for (const bad of [5.5, 25, 10.3, "11", Number.NaN]) expect(normalizeSettings({ pdfFontSizePt: bad }).pdfFontSizePt).toBe(10.5);
		expect(normalizeSettings({ pdfFontFamily: "  Meiryo  ", pdfCodeFontFamily: "" })).toMatchObject({ pdfFontFamily: "Meiryo", pdfCodeFontFamily: "" });
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
