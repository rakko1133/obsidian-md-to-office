// frontmatter → 文書プロパティ（A-27・フェーズ 3 の決定事項）。Obsidian API に依存しない。
// 既定の対応: title → タイトル、author → 作成者、tags → キーワード、created → 作成日時。それ以外はユーザー設定のプロパティ。
import type { DocumentProperties } from "./docx-render";

export interface MappedProperties {
	title?: string;
	author?: string;
	properties: DocumentProperties;
	/** プロパティの表（A-27 のオプション）に出す行 */
	table: [string, string][];
}

const MAPPED_KEYS = new Set(["title", "author", "tags", "created"]);

/** 値を文字にする。配列は「, 」でつなぎ、オブジェクトは JSON にする。 */
export function valueToText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (Array.isArray(value)) return value.map(valueToText).join(", ");
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

/** 日付として読める値なら Date。 */
export function parseDate(value: unknown): Date | undefined {
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

export function mapFrontmatter(frontmatter: Readonly<Record<string, unknown>> | undefined): MappedProperties {
	const out: MappedProperties = { properties: {}, table: [] };
	if (!frontmatter) return out;
	const title = valueToText(frontmatter.title).trim();
	if (title) out.title = title;
	const author = valueToText(frontmatter.author).replace(/, /g, "; ").trim();
	if (author) out.author = author;
	const tags = frontmatter.tags;
	const tagList = (Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[,\s]+/) : []).map((t) => valueToText(t).replace(/^#/, "").trim()).filter((t) => t !== "");
	if (tagList.length > 0) out.properties.keywords = tagList.join(", ");
	const created = parseDate(frontmatter.created);
	if (created) out.properties.created = created;
	const custom: { name: string; value: string }[] = [];
	for (const [key, value] of Object.entries(frontmatter)) {
		if (key === "position") continue;
		out.table.push([key, valueToText(value)]);
		if (!MAPPED_KEYS.has(key) && key.trim() !== "") custom.push({ name: key, value: valueToText(value) });
	}
	if (custom.length > 0) out.properties.custom = custom;
	return out;
}
