// Word のテンプレート（C-1b・フェーズ 5b）。Obsidian API に依存しない。
// .docx / .dotx（zip）から word/styles.xml を取り出し、テーマ（色・フォント）も読む。docx ライブラリの externalStyles と theme に渡す。
import { readTheme, type IThemeOptions } from "docx";
import { strFromU8, unzipSync } from "fflate";

export interface WordTemplate {
	styles: string;
	theme?: IThemeOptions;
}

/** テンプレートを読む。styles.xml がなければ例外。テーマが読めなければテーマなし。 */
export function readTemplate(bytes: Uint8Array): WordTemplate {
	const files = unzipSync(bytes, { filter: (file) => file.name === "word/styles.xml" });
	const styles = files["word/styles.xml"];
	if (!styles) throw new Error("word/styles.xml not found");
	let theme: IThemeOptions | undefined;
	try {
		theme = readTheme(bytes);
	} catch {
		theme = undefined;
	}
	return { styles: normalizeStyleIds(strFromU8(styles)), ...(theme ? { theme } : {}) };
}

/** 組み込みスタイルの名前（w:name の小文字）→ この .docx の段落が参照する ID（docx ライブラリの ID）。 */
const BUILTIN_IDS: Readonly<Record<string, string>> = {
	title: "Title",
	"heading 1": "Heading1",
	"heading 2": "Heading2",
	"heading 3": "Heading3",
	"heading 4": "Heading4",
	"heading 5": "Heading5",
	"heading 6": "Heading6",
	quote: "Quote",
	caption: "Caption",
	hyperlink: "Hyperlink",
	"footnote text": "FootnoteText",
	"footnote reference": "FootnoteReference",
	"list paragraph": "ListParagraph",
};

/**
 * 組み込みスタイルの ID を、docx ライブラリの ID にそろえる。
 * 日本語版などの Word は、組み込みスタイルを言語ごとの ID（見出し 1 なら "1"）で保存するので、そのままでは
 * この .docx の段落（pStyle="Heading1"）にテンプレートのスタイルが効かない。名前（w:name）で見分けて ID を付け直し、
 * basedOn・next・link の参照も合わせる。
 */
export function normalizeStyleIds(stylesXml: string): string {
	const rename = new Map<string, string>();
	for (const m of stylesXml.matchAll(/<w:style\b[^>]*\bw:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g)) {
		const id = m[1];
		const target = BUILTIN_IDS[m[2].toLowerCase()];
		if (target && target !== id) rename.set(id, target);
	}
	if (rename.size === 0) return stylesXml;
	const existing = styleIds(stylesXml);
	// 付け直し先の ID がすでにあるときは付け直さない（重複を避ける）
	for (const [from, to] of rename) if (existing.has(to)) rename.delete(from);
	return stylesXml
		.replace(/(\bw:styleId=")([^"]+)(")/g, (all, a: string, id: string, b: string) => (rename.has(id) ? `${a}${rename.get(id)}${b}` : all))
		.replace(/(<w:(?:basedOn|next|link) w:val=")([^"]+)(")/g, (all, a: string, id: string, b: string) => (rename.has(id) ? `${a}${rename.get(id)}${b}` : all));
}

/** styles.xml に定義されているスタイルの ID。 */
export function styleIds(stylesXml: string): Set<string> {
	return new Set([...stylesXml.matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]));
}
