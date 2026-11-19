// PDF 出力（H1-PDF・フェーズ 7）の、Obsidian に依存しない部分: 出力先・ドライラン・ページ設定・リンク先の決め方。
// 描画と印刷は src/obsidian/pdf-print.ts、後処理は pdf-postprocess.ts。
import type { PlannedOutput } from "./docx-export";
import { combinedOutputRef } from "./docx-combine";
import { joinPath, noteBaseName, outputDirFor, plannedAction, relativeUrl } from "./output-plan";
import type { PluginSettings } from "./settings";
import type { ManifestSnapshot, OutputRef } from "./types";

const MM_PER_INCH = 25.4;

/** 1 ノート = 1 PDF の出力先（R8 の考え方を PDF にも使う）。 */
export function pdfOutputRef(notePath: string, settings: Pick<PluginSettings, "saveMode" | "outputLocation" | "outputRoot">): OutputRef {
	const dir = outputDirFor(notePath, settings);
	return { location: dir.location, path: joinPath(dir.path, `${noteBaseName(notePath)}.pdf`) };
}

/**
 * ノートが入る PDF の出力先。結合出力で今回の対象なら、そのフォルダの PDF（`{フォルダ名}.pdf`）、
 * それ以外は `{ノート名}.pdf`。
 */
export function pdfTargetRef(
	notePath: string,
	settings: Pick<PluginSettings, "saveMode" | "outputLocation" | "outputRoot">,
	options: { combine: boolean; vaultName: string; selected: ReadonlySet<string> },
): OutputRef {
	return options.combine && options.selected.has(notePath) ? combinedOutputRef(notePath, settings, options.vaultName, "pdf") : pdfOutputRef(notePath, settings);
}

/** ドライラン: PDF の出力先と予定動作。 */
export async function planPdfNote(
	notePath: string,
	settings: PluginSettings,
	combine: boolean,
	vaultName: string,
	exists: (ref: OutputRef) => Promise<boolean>,
): Promise<PlannedOutput[]> {
	const output = combine ? combinedOutputRef(notePath, settings, vaultName, "pdf") : pdfOutputRef(notePath, settings);
	return [{ output, action: plannedAction(await exists(output), false, settings.onConflict) }];
}

/** PDF になる（なった）ノート: 今回の対象と、記録に PDF として残るノート（A-18 の考え方を PDF にも使う）。 */
export function pdfConvertedNotes(selected: Iterable<string>, manifest: ManifestSnapshot): Set<string> {
	const out = new Set(selected);
	for (const entry of manifest.entries) if (entry.kind === "pdf") for (const source of entry.sources) out.add(source);
	return out;
}

/** リンク先のノートの PDF への相対パス（`/` 区切り、符号化しない）。出力先の場所が違えば null。 */
export function pdfRelativePath(from: OutputRef, to: OutputRef): string | null {
	const url = relativeUrl(from, to);
	return url === null ? null : decodeURIComponent(url);
}

/** 用紙の大きさ（mm、縦向き）。B5 は JIS B5（Word の C-2 と同じ）。 */
const PAPER_MM: Record<PluginSettings["pdfPaperSize"], { width: number; height: number }> = {
	A4: { width: 210, height: 297 },
	A3: { width: 297, height: 420 },
	B5: { width: 182, height: 257 },
	Letter: { width: 215.9, height: 279.4 },
};

/** printToPDF に渡すページ設定（大きさと余白はインチ）。 */
export interface PdfPageOptions {
	pageSize: { width: number; height: number };
	landscape: boolean;
	/** 0.1〜2 */
	scale: number;
	margins: { top: number; bottom: number; left: number; right: number };
}

export function pdfPageOptions(settings: Pick<PluginSettings, "pdfPaperSize" | "pdfOrientation" | "pdfMarginsMm" | "pdfScale">): PdfPageOptions {
	const paper = PAPER_MM[settings.pdfPaperSize];
	const inch = (mm: number) => mm / MM_PER_INCH;
	const m = settings.pdfMarginsMm;
	return {
		// 向きは landscape で渡す（pageSize は縦向きの大きさのまま）
		pageSize: { width: inch(paper.width), height: inch(paper.height) },
		landscape: settings.pdfOrientation === "landscape",
		scale: Math.min(2, Math.max(0.1, settings.pdfScale / 100)),
		margins: { top: inch(m.top), bottom: inch(m.bottom), left: inch(m.left), right: inch(m.right) },
	};
}

/** CSS の 1 インチ（px）。 */
const CSS_PX_PER_INCH = 96;
/** 画像・図の最大の高さの、印字領域の高さに対する割合。 */
const IMAGE_HEIGHT_RATIO = 0.85;

/**
 * 画像・図の最大の高さ（CSS px）。1 ページの印字領域から決め、ページの境目で切れないようにする。
 * 印刷では、レイアウトの大きさ = 用紙の大きさ ÷ 拡大率になる。ヘッダー・フッターは余白の中に印刷される。
 * 直前の見出しと同じページに入るよう、印字領域の 85% にする。
 */
export function pdfPrintableHeightPx(page: PdfPageOptions): number {
	const paperHeight = page.landscape ? page.pageSize.width : page.pageSize.height;
	const inches = paperHeight - page.margins.top - page.margins.bottom;
	return Math.max(1, Math.floor(((inches * CSS_PX_PER_INCH) / page.scale) * IMAGE_HEIGHT_RATIO));
}

/**
 * リンクの部分パス（`#見出し`・`#親#子`・`#^ブロックID`）から、見出しの名前を取り出す。
 * 入れ子の見出しは最後の要素を使う。ブロック ID・空なら null（ノートの先頭へのリンクにする）。
 */
export function headingOfSubpath(subpath: string): string | null {
	const parts = subpath.split("#").map((p) => p.trim()).filter((p) => p !== "");
	const last = parts[parts.length - 1];
	if (last === undefined || last.startsWith("^")) return null;
	return last;
}

/** 見出しの名前の比べ方（Obsidian のリンクは大文字・小文字と前後の空白を区別しない）。 */
export function headingKey(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}
