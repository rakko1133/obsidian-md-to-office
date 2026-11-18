// .xlsx の値と名前の規則（R7 の D-1d・D-2・D-3）。Obsidian API にも exceljs にも依存しない純粋関数だけを置く。

/** 列の型（D-2）。判定できなければ文字列。 */
export type ColumnKind = "string" | "number" | "percent" | "currency" | "date" | "boolean";

export interface ColumnType {
	kind: ColumnKind;
	/** セルの表示形式（Excel の number format）。General のままなら undefined */
	numFmt?: string;
}

/** 型に変換したセルの値。 */
export type CellValue = number | boolean | Date;

/** Excel の数値の有効桁数（これを超える桁の数字は精度が落ちるので文字列のまま: D-2） */
const MAX_DIGITS = 15;

const PLAIN_NUMBER = /^-?\d+(?:\.(\d+))?$/;
const GROUPED_NUMBER = /^-?\d{1,3}(?:,\d{3})+(?:\.(\d+))?$/;
const PERCENT = /^(-?\d+(?:\.(\d+))?)%$/;
const DATE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?: (\d{1,2}):(\d{2}))?$/;
const BOOLEAN = /^(true|false)$/i;
const POSTAL_CODE = /^\d{3}-\d{4}$/;
const PHONE = /^0\d{1,4}-\d{1,4}-\d{3,4}$/;
const LEADING_ZERO = /^-?0\d+$/;

interface ParsedNumber {
	value: number;
	decimals: number;
	grouped: boolean;
}

/** `123`・`-1.5`・`1,200` を数値として読む。読めなければ null。 */
function parseNumber(text: string): ParsedNumber | null {
	const plain = PLAIN_NUMBER.exec(text);
	const grouped = plain ? null : GROUPED_NUMBER.exec(text);
	const m = plain ?? grouped;
	if (!m) return null;
	const value = Number(text.replace(/,/g, ""));
	if (!Number.isFinite(value)) return null;
	return { value, decimals: m[1]?.length ?? 0, grouped: grouped !== null };
}

/** 文字列のままにする例外（D-2）: 先頭がゼロの整数、郵便番号・電話番号の形、15 桁を超える数字。 */
export function mustStayString(text: string): boolean {
	if (LEADING_ZERO.test(text) || POSTAL_CODE.test(text) || PHONE.test(text)) return true;
	const digits = text.replace(/\D/g, "").length;
	return /^[-\d.,%¥￥$円\s]+$/.test(text) && digits > MAX_DIGITS;
}

type Currency = "yen" | "dollar" | "yenSuffix";

function parseCurrency(text: string): { currency: Currency; number: ParsedNumber } | null {
	let currency: Currency;
	let body: string;
	if (/^[¥￥]/.test(text)) {
		currency = "yen";
		body = text.slice(1);
	} else if (text.startsWith("$")) {
		currency = "dollar";
		body = text.slice(1);
	} else if (text.endsWith("円")) {
		currency = "yenSuffix";
		body = text.slice(0, -1);
	} else return null;
	const number = parseNumber(body.trim());
	return number ? { currency, number } : null;
}

function parseDate(text: string): { date: Date; hasTime: boolean } | null {
	const m = DATE.exec(text);
	if (!m) return null;
	const [y, mo, d, h, mi] = [m[1], m[3], m[4], m[5], m[6]].map((v) => (v === undefined ? undefined : Number(v)));
	if (mo! < 1 || mo! > 12 || d! < 1 || d! > 31) return null;
	if (h !== undefined && (h > 23 || mi! > 59)) return null;
	// 書かれた日時をそのまま Excel の日時にする（exceljs は Date を UTC として書くので、UTC で作る）
	const date = new Date(Date.UTC(y!, mo! - 1, d, h ?? 0, mi ?? 0));
	if (date.getUTCMonth() !== mo! - 1) return null; // 2 月 30 日など
	return { date, hasTime: h !== undefined };
}

const decimalsFormat = (decimals: number) => (decimals > 0 ? `.${"0".repeat(Math.min(decimals, 10))}` : "");

/**
 * 列の型を判定する（D-2）。空のセルを除いたすべてのセルが同じ型として読めるときだけ、その型にする。
 * 例外の形（先頭ゼロ・郵便番号・電話番号・15 桁超）が 1 つでもあれば文字列。
 */
export function detectColumnType(texts: readonly string[]): ColumnType {
	const values = texts.map((t) => t.trim()).filter((t) => t !== "");
	if (values.length === 0 || values.some(mustStayString)) return { kind: "string" };

	const numbers = values.map(parseNumber);
	if (numbers.every((n) => n !== null)) {
		const decimals = Math.max(...numbers.map((n) => n.decimals));
		if (numbers.some((n) => n.grouped)) return { kind: "number", numFmt: `#,##0${decimalsFormat(decimals)}` };
		return { kind: "number" };
	}

	const percents = values.map((v) => PERCENT.exec(v));
	if (percents.every((m) => m !== null)) {
		const decimals = Math.max(...percents.map((m) => m[2]?.length ?? 0));
		return { kind: "percent", numFmt: `0${decimalsFormat(decimals)}%` };
	}

	const currencies = values.map(parseCurrency);
	if (currencies.every((c) => c !== null) && new Set(currencies.map((c) => c.currency)).size === 1) {
		const decimals = Math.max(...currencies.map((c) => c.number.decimals));
		const body = `#,##0${decimalsFormat(decimals)}`;
		const currency = currencies[0].currency;
		return { kind: "currency", numFmt: currency === "yen" ? `"¥"${body}` : currency === "dollar" ? `"$"${body}` : `${body}"円"` };
	}

	const dates = values.map(parseDate);
	if (dates.every((d) => d !== null)) return { kind: "date", numFmt: dates.some((d) => d.hasTime) ? "yyyy-mm-dd hh:mm" : "yyyy-mm-dd" };

	if (values.every((v) => BOOLEAN.test(v))) return { kind: "boolean" };
	return { kind: "string" };
}

/** セルの文字を、判定した列の型の値にする。空のセルや読めない値は null（文字列のまま書く）。 */
export function convertCell(text: string, type: ColumnType): CellValue | null {
	const v = text.trim();
	if (v === "") return null;
	switch (type.kind) {
		case "number":
			return parseNumber(v)?.value ?? null;
		case "percent": {
			const m = PERCENT.exec(v);
			return m ? Number(m[1]) / 100 : null;
		}
		case "currency":
			return parseCurrency(v)?.number.value ?? null;
		case "date":
			return parseDate(v)?.date ?? null;
		case "boolean":
			return BOOLEAN.test(v) ? v.toLowerCase() === "true" : null;
		case "string":
			return null;
	}
}

/** Excel のシート名の上限（文字数） */
export const SHEET_NAME_MAX = 31;

/**
 * シート名を決める（D-1d）。禁止文字 `[ ] : * ? / \` を `_` にし、先頭・末尾の `'` を外し、31 文字に切り詰める。
 * 空なら fallback、予約名 History は History_。重複は大文字・小文字を区別せずに判定し、末尾に ` (2)` などを付ける。
 * 決めた名前は used に足す（小文字で）。
 */
export function uniqueSheetName(raw: string, used: Set<string>, fallback = "Sheet"): string {
	let base = raw.replace(/[[\]:*?/\\]/g, "_").replace(/[\r\n\t]/g, " ").trim().replace(/^'+|'+$/g, "").trim();
	if (base === "") base = fallback;
	if (base.toLowerCase() === "history") base = `${base}_`;
	base = truncate(base, SHEET_NAME_MAX);
	let name = base;
	for (let n = 2; used.has(name.toLowerCase()); n++) {
		const suffix = ` (${n})`;
		name = truncate(base, SHEET_NAME_MAX - suffix.length).trimEnd() + suffix;
	}
	used.add(name.toLowerCase());
	return name;
}

function truncate(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join("");
}

/** Excel テーブルの列名を一意にする（D-3）。空なら emptyName(列番号)、重複なら ` (2)` などを付ける（大文字・小文字を区別しない）。 */
export function uniqueColumnNames(names: readonly string[], emptyName: (index: number) => string): string[] {
	const used = new Set<string>();
	return names.map((raw, i) => {
		const base = raw.replace(/[\r\n]+/g, " ").trim() || emptyName(i + 1);
		let name = base;
		for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
		used.add(name.toLowerCase());
		return name;
	});
}

/** Excel テーブルの名前（ブック内で一意）。 */
export function tableName(index: number): string {
	return `Table${index}`;
}

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** 表示幅（半角 = 1、全角 = 2）。複数行なら最も長い行。 */
export function displayWidth(text: string): number {
	let max = 0;
	for (const line of text.split("\n")) {
		let width = 0;
		for (const ch of line) width += WIDE.test(ch) || ch.codePointAt(0)! > 0xffff ? 2 : 1;
		max = Math.max(max, width);
	}
	return max;
}

/** 列幅の規則（D-3） */
export const COLUMN_WIDTH = { min: 8, max: 60, padding: 2 } as const;

/** 列幅（文字数）と、折り返し表示が要るか。 */
export function columnWidth(maxDisplayWidth: number): { width: number; wrap: boolean } {
	const width = maxDisplayWidth + COLUMN_WIDTH.padding;
	if (width > COLUMN_WIDTH.max) return { width: COLUMN_WIDTH.max, wrap: true };
	return { width: Math.max(COLUMN_WIDTH.min, width), wrap: false };
}

/** 横向きにする列幅の合計（文字数: D-5） */
export const LANDSCAPE_TOTAL_WIDTH = 120;

/** Excel のセルの文字数の上限（D-4） */
export const CELL_TEXT_MAX = 32767;

/** シートへのリンク（目次・同じブックのノート: D-1c）。シート名の `'` は `''` にする。 */
export function sheetLink(sheetName: string): string {
	return `#'${sheetName.replace(/'/g, "''")}'!A1`;
}
