// プラグインの設定値の型と既定値。Obsidian API に依存しない（G2・G4）。
// 設定項目の一覧と既定値の正本は docs/design/settings.md。

export interface PluginSettings {
	/** 出力先の場所（G4） */
	outputLocation: "vault" | "external";
	/** 出力ルート。Vault 内のフォルダのパス（G4・R8） */
	outputRoot: string;
	/** Vault 外の出力ルート（絶対パス）。outputLocation が external のときに使う（G4） */
	externalOutputRoot: string;
	/** 保存モード（R1・R8） */
	saveMode: "mirror" | "sameFolder";
	/** 同名ファイルの扱い（R3） */
	onConflict: "overwrite" | "skip" | "rename";
	/** エラー時の方針（R3） */
	onError: "continue" | "failFast";
	/** 1 件ごとのタイムアウト（秒）（R3） */
	timeoutSeconds: number;
	/** 含めるパターン。空ならすべて（R2） */
	includeGlobs: string[];
	/** 除外するパターン（R2） */
	excludeGlobs: string[];
	/** 画像ファイルとして保存する形式（R1） */
	mermaidImageFormat: "svg" | "png" | "both";
	/** PNG の解像度（R4） */
	pngDpi: number;
	/** PNG の背景を透過にする（R4） */
	pngTransparentBackground: boolean;
	/** Mermaid のフォント（R4） */
	mermaidFontFamily: string;
	/** 変換時に画像ファイルも保存する（R8） */
	saveImageFiles: boolean;
	/** 文書プロパティの作成者名（C-8・D-5） */
	authorName: string;
	/** 見出しを 1 段下げ、ファイル名を「表題」にする（A-1） */
	fileNameAsTitle: boolean;
	/** Obsidian の「厳密な改行」の設定を読めなかったときに使う値（A-2） */
	strictLineBreaksFallback: boolean;
	/** 用紙サイズ（C-2） */
	paperSize: "A4" | "B5" | "Letter";
	/** 印刷の向き（C-2） */
	orientation: "portrait" | "landscape";
	/** 余白（mm）（C-2） */
	marginsMm: { top: number; bottom: number; left: number; right: number };
	/** 本文のフォント（C-3） */
	bodyFontEastAsia: string;
	bodyFontLatin: string;
	/** 見出しのフォント（C-3） */
	headingFontEastAsia: string;
	headingFontLatin: string;
	/** コードブロックに行番号を付ける（A-7） */
	codeLineNumbers: boolean;
	/** `%%…%%` を Word のコメントとして残す（A-16） */
	keepCommentsAsWordComments: boolean;
	/** 冒頭に frontmatter のプロパティの表を出す（A-27） */
	frontmatterTable: boolean;
	/** 外部の画像をダウンロードして埋め込む（A-20） */
	downloadExternalImages: boolean;
	/** コールアウトの色: 既定色の固定の表 / テーマの色（A-6） */
	calloutColorSource: "fixed" | "theme";
}

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
	outputLocation: "vault",
	outputRoot: "_export",
	externalOutputRoot: "",
	saveMode: "mirror",
	onConflict: "overwrite",
	onError: "continue",
	timeoutSeconds: 30,
	includeGlobs: [],
	excludeGlobs: ["**/*.excalidraw.md"],
	mermaidImageFormat: "png",
	pngDpi: 192,
	pngTransparentBackground: false,
	mermaidFontFamily: '"Yu Gothic", "YuGothic", "Hiragino Sans", "Meiryo", sans-serif',
	saveImageFiles: false,
	authorName: "",
	fileNameAsTitle: false,
	strictLineBreaksFallback: false,
	paperSize: "A4",
	orientation: "portrait",
	marginsMm: { top: 25, bottom: 25, left: 25, right: 25 },
	bodyFontEastAsia: "游明朝",
	bodyFontLatin: "Century",
	headingFontEastAsia: "游ゴシック",
	headingFontLatin: "Arial",
	codeLineNumbers: false,
	keepCommentsAsWordComments: false,
	frontmatterTable: false,
	downloadExternalImages: false,
	calloutColorSource: "fixed",
};

/**
 * data.json から読み込んだ値を、欠けている項目は既定値で補い、形を整えて返す。
 * 読み込んだ値が壊れていても例外にせず、その項目を既定値に戻す。
 */
export function normalizeSettings(raw: unknown): PluginSettings {
	const data = isRecord(raw) ? raw : {};
	const d = DEFAULT_SETTINGS;
	return {
		outputLocation: oneOf(data.outputLocation, ["vault", "external"], d.outputLocation),
		outputRoot: normalizeFolderPath(data.outputRoot, d.outputRoot),
		externalOutputRoot: typeof data.externalOutputRoot === "string" ? data.externalOutputRoot.trim() : d.externalOutputRoot,
		saveMode: oneOf(data.saveMode, ["mirror", "sameFolder"], d.saveMode),
		onConflict: oneOf(data.onConflict, ["overwrite", "skip", "rename"], d.onConflict),
		onError: oneOf(data.onError, ["continue", "failFast"], d.onError),
		timeoutSeconds: positiveInt(data.timeoutSeconds, d.timeoutSeconds),
		includeGlobs: stringList(data.includeGlobs, d.includeGlobs),
		excludeGlobs: stringList(data.excludeGlobs, d.excludeGlobs),
		mermaidImageFormat: oneOf(data.mermaidImageFormat, ["svg", "png", "both"], d.mermaidImageFormat),
		pngDpi: positiveInt(data.pngDpi, d.pngDpi),
		pngTransparentBackground: typeof data.pngTransparentBackground === "boolean" ? data.pngTransparentBackground : d.pngTransparentBackground,
		mermaidFontFamily:
			typeof data.mermaidFontFamily === "string" && data.mermaidFontFamily.trim() !== ""
				? data.mermaidFontFamily.trim()
				: d.mermaidFontFamily,
		saveImageFiles: bool(data.saveImageFiles, d.saveImageFiles),
		authorName: typeof data.authorName === "string" ? data.authorName.trim() : d.authorName,
		fileNameAsTitle: bool(data.fileNameAsTitle, d.fileNameAsTitle),
		strictLineBreaksFallback: bool(data.strictLineBreaksFallback, d.strictLineBreaksFallback),
		paperSize: oneOf(data.paperSize, ["A4", "B5", "Letter"], d.paperSize),
		orientation: oneOf(data.orientation, ["portrait", "landscape"], d.orientation),
		marginsMm: margins(data.marginsMm, d.marginsMm),
		bodyFontEastAsia: text(data.bodyFontEastAsia, d.bodyFontEastAsia),
		bodyFontLatin: text(data.bodyFontLatin, d.bodyFontLatin),
		headingFontEastAsia: text(data.headingFontEastAsia, d.headingFontEastAsia),
		headingFontLatin: text(data.headingFontLatin, d.headingFontLatin),
		codeLineNumbers: bool(data.codeLineNumbers, d.codeLineNumbers),
		keepCommentsAsWordComments: bool(data.keepCommentsAsWordComments, d.keepCommentsAsWordComments),
		frontmatterTable: bool(data.frontmatterTable, d.frontmatterTable),
		downloadExternalImages: bool(data.downloadExternalImages, d.downloadExternalImages),
		calloutColorSource: oneOf(data.calloutColorSource, ["fixed", "theme"], d.calloutColorSource),
	};
}

/** Vault 内のフォルダのパスを整える。前後の空白と、先頭・末尾の `/` を除く。空なら既定値。 */
export function normalizeFolderPath(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return trimmed === "" ? fallback : trimmed;
}

/** 改行区切りの文字列を、空行を除いたパターンの配列にする（設定画面の入力欄用）。 */
export function parseLines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

/** 余白（mm）。0 以上 100 未満の数値だけを受け付ける。 */
function margins(value: unknown, fallback: PluginSettings["marginsMm"]): PluginSettings["marginsMm"] {
	const v = isRecord(value) ? value : {};
	const one = (x: unknown, f: number) => (typeof x === "number" && x >= 0 && x < 100 ? x : f);
	return { top: one(v.top, fallback.top), bottom: one(v.bottom, fallback.bottom), left: one(v.left, fallback.left), right: one(v.right, fallback.right) };
}

function positiveInt(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function stringList(value: unknown, fallback: readonly string[]): string[] {
	if (!Array.isArray(value)) return [...fallback];
	return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((s) => s.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
