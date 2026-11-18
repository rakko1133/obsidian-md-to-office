import { Workbook, type Worksheet } from "exceljs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { applyResults } from "../src/core/manifest";
import type { OutputWriter } from "../src/core/mermaid-export";
import { refKey } from "../src/core/output-plan";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/core/settings";
import type { NoteResult, OutputRef } from "../src/core/types";
import { XlsxRun, xlsxOutputRef, xlsxUnit } from "../src/core/xlsx-export";
import { columnLetter, type XlsxLabels } from "../src/core/xlsx-render";
import {
	columnWidth,
	convertCell,
	detectColumnType,
	displayWidth,
	mustStayString,
	sheetLink,
	uniqueColumnNames,
	uniqueSheetName,
} from "../src/core/xlsx-values";

// 規則の単体テスト（R7 の D-1d・D-2・D-3）
describe("列の型の判定（D-2）", () => {
	it.each([
		[["1", "20", "-3"], { kind: "number" }],
		[["0.5", "1.25", "10"], { kind: "number" }],
		[["1,200", "34,500", "7"], { kind: "number", numFmt: "#,##0" }],
		[["1,200.5", "3"], { kind: "number", numFmt: "#,##0.0" }],
		[["12%", "7.5%", "100%"], { kind: "percent", numFmt: "0.0%" }],
		[["¥1,200", "￥80", "¥0"], { kind: "currency", numFmt: '"¥"#,##0' }],
		[["$3.50", "$12.00"], { kind: "currency", numFmt: '"$"#,##0.00' }],
		[["980円", "1,500円"], { kind: "currency", numFmt: '#,##0"円"' }],
		[["2026-11-18", "2026/12/01"], { kind: "date", numFmt: "yyyy-mm-dd" }],
		[["2026-11-18 09:30", "2026-12-01"], { kind: "date", numFmt: "yyyy-mm-dd hh:mm" }],
		[["true", "FALSE", "False"], { kind: "boolean" }],
		[["0", "1", "1"], { kind: "number" }],
		[["5", "", "7"], { kind: "number" }],
	])("%j → %j", (values, expected) => {
		expect(detectColumnType(values)).toEqual(expected);
	});

	it.each([
		["1 つでも読めないセルがある", ["10", "二十"]],
		["先頭ゼロ", ["00123", "1"]],
		["郵便番号の形", ["123-4567"]],
		["電話番号の形", ["03-1234-5678", "090-1234-5678"]],
		["15 桁を超える数字", ["1234567890123456"]],
		["通貨記号がそろっていない", ["¥100", "$1"]],
		["年のない日付", ["11/17"]],
		["ありえない日付", ["2026-02-30"]],
		["はい・いいえ", ["はい", "いいえ"]],
		["負の数の別表記", ["△100", "(100)"]],
		["すべて空", ["", " "]],
		["数式の形", ["=SUM(A1:A3)"]],
	])("%s は文字列", (_label, values) => {
		expect(detectColumnType(values)).toEqual({ kind: "string" });
	});

	it("15 桁ちょうどは数値、16 桁は文字列", () => {
		expect(mustStayString("123456789012345")).toBe(false);
		expect(mustStayString("1234567890123456")).toBe(true);
		expect(mustStayString("0")).toBe(false);
		expect(mustStayString("0.5")).toBe(false);
	});

	it("値への変換", () => {
		expect(convertCell("1,200", { kind: "number" })).toBe(1200);
		expect(convertCell("12.5%", { kind: "percent" })).toBeCloseTo(0.125);
		expect(convertCell("¥1,200", { kind: "currency" })).toBe(1200);
		expect(convertCell("980円", { kind: "currency" })).toBe(980);
		expect(convertCell("FALSE", { kind: "boolean" })).toBe(false);
		// 書かれた日時をそのまま（時差でずれない: UTC で作る）
		expect((convertCell("2026-11-18 09:30", { kind: "date" }) as Date).toISOString()).toBe("2026-11-18T09:30:00.000Z");
		expect(convertCell("", { kind: "number" })).toBeNull();
		expect(convertCell("abc", { kind: "string" })).toBeNull();
	});
});

describe("シート名・列名・列幅（D-1d・D-3）", () => {
	it("禁止文字・31 文字・重複（大文字・小文字を区別しない）・予約名", () => {
		const used = new Set<string>();
		expect(uniqueSheetName("a[b]:c*d?e/f\\g", used)).toBe("a_b__c_d_e_f_g");
		expect(uniqueSheetName("'引用'", used)).toBe("引用");
		expect(uniqueSheetName("", used)).toBe("Sheet");
		expect(uniqueSheetName("history", used)).toBe("history_");
		const long = "あ".repeat(40);
		expect(uniqueSheetName(long, used)).toBe("あ".repeat(31));
		expect(uniqueSheetName(long, used)).toBe(`${"あ".repeat(27)} (2)`);
		expect(uniqueSheetName("Data", used)).toBe("Data");
		expect(uniqueSheetName("DATA", used)).toBe("DATA (2)");
	});

	it("列名: 空は「列n」、重複は (2)", () => {
		expect(uniqueColumnNames(["", "名前", "名前", "Name", "name"], (i) => `列${i}`)).toEqual(["列1", "名前", "名前 (2)", "Name", "name (2)"]);
	});

	it("表示幅: 全角は 2、複数行は最も長い行", () => {
		expect(displayWidth("abc")).toBe(3);
		expect(displayWidth("あいう")).toBe(6);
		expect(displayWidth("ab\nあいうえ")).toBe(8);
		expect(columnWidth(1)).toEqual({ width: 8, wrap: false });
		expect(columnWidth(20)).toEqual({ width: 22, wrap: false });
		expect(columnWidth(100)).toEqual({ width: 60, wrap: true });
	});

	it("シートへのリンクと列の文字", () => {
		expect(sheetLink("It's")).toBe("#'It''s'!A1");
		expect(columnLetter(0)).toBe("A");
		expect(columnLetter(25)).toBe("Z");
		expect(columnLetter(26)).toBe("AA");
	});
});

describe("ブックの出力先と単位（R8）", () => {
	const settings = DEFAULT_SETTINGS;
	it("1 件なら単一ノート、2 件以上は設定の単位", () => {
		expect(xlsxUnit(1, settings)).toBe("single");
		expect(xlsxUnit(2, settings)).toBe("perFolder");
		expect(xlsxUnit(2, { excelBookUnit: "perNote" })).toBe("perNote");
	});
	it("ファイル名", () => {
		expect(xlsxOutputRef("a/b/note.md", "single", settings, "V").path).toBe("_export/a/b/note.xlsx");
		expect(xlsxOutputRef("a/b/note.md", "perFolder", settings, "V").path).toBe("_export/a/b/b.xlsx");
		expect(xlsxOutputRef("note.md", "perFolder", settings, "V").path).toBe("_export/V.xlsx");
		expect(xlsxOutputRef("a/note.md", "perFolder", { ...settings, saveMode: "sameFolder" }, "V")).toEqual({ location: "vault", path: "a/a.xlsx" });
	});
});

// サンプルを .xlsx にして中身を確かめる（G5）
const VAULT_DIR = "test-vault";
const PNG_1x1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"), (ch) => ch.charCodeAt(0));

function vaultFiles(dir = VAULT_DIR): string[] {
	return readdirSync(dir).flatMap((name) => {
		if (name.startsWith(".")) return [];
		const full = join(dir, name);
		return statSync(full).isDirectory() ? vaultFiles(full) : [relative(VAULT_DIR, full).split("\\").join("/")];
	});
}
const FILES = vaultFiles();

function fakeResolve(linkpath: string): string | null {
	const exact = FILES.find((f) => f === linkpath || f === `${linkpath}.md`);
	if (exact) return exact;
	const name = linkpath.slice(linkpath.lastIndexOf("/") + 1);
	return FILES.find((f) => f.endsWith(`/${name}`) || f.endsWith(`/${name}.md`)) ?? null;
}

const LABELS: XlsxLabels = {
	toc: "目次",
	sheet: "シート",
	source: "元ノート",
	heading: "見出し",
	tableCount: "表の数",
	column: (n) => `列${n}`,
	table: (n) => `表 ${n}`,
};

/** 書き込んだバイト列を覚えておく偽の書き込み先。 */
class MemoryWriter implements OutputWriter {
	readonly files = new Map<string, Uint8Array>();
	async exists(ref: OutputRef) {
		return this.files.has(refKey(ref));
	}
	async write(ref: OutputRef, bytes: Uint8Array) {
		this.files.set(refKey(ref), bytes);
		return { status: "success" as const, contentHash: `hash-${bytes.length}` };
	}
	async hashOf() {
		return null;
	}
	async remove() {
		return true;
	}
}

async function convertFolder(notes: string[], overrides: Partial<PluginSettings> = {}) {
	const writer = new MemoryWriter();
	const settings = { ...DEFAULT_SETTINGS, ...overrides };
	const run = new XlsxRun(settings, notes, {
		readNote: async (p) => readFileSync(join(VAULT_DIR, p), "utf8"),
		writer,
		labels: LABELS,
		vault: {
			resolveLink: fakeResolve,
			fileExists: (p) => FILES.includes(p),
			vaultName: "test-vault",
			loadImage: async () => ({ type: "png", data: PNG_1x1, width: 640, height: 400 }),
		},
	});
	const results: NoteResult[] = [];
	for (const note of notes) results.push(await run.addNote(note, new AbortController().signal));
	await run.finish(results);
	return { writer, results };
}

async function load(bytes: Uint8Array): Promise<Workbook> {
	const wb = new Workbook();
	await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
	return wb;
}

const EXCEL_NOTES = FILES.filter((f) => f.startsWith("excel/") && f.endsWith(".md")).sort();

describe("サンプルの .xlsx（test-vault/excel）", async () => {
	const { writer, results } = await convertFolder(EXCEL_NOTES);
	const main = writer.files.get("vault:_export/excel/excel.xlsx")!;
	const wb = await load(main);
	const sheet = (name: string): Worksheet => wb.getWorksheet(name)!;

	it("フォルダごとに 1 ブック（サブフォルダは別のブック）", () => {
		expect([...writer.files.keys()].sort()).toEqual(["vault:_export/excel/excel.xlsx", "vault:_export/excel/parts/parts.xlsx", "vault:_export/excel/sub/sub.xlsx"]);
	});

	it("表のないノートはスキップ（表なし）、ほかはブックの結果が付く", () => {
		const noTable = results.find((r) => r.notePath === "excel/04-no-table.md")!;
		expect(noTable).toMatchObject({ status: "skipped", reason: "noTables", files: [] });
		const types = results.find((r) => r.notePath === "excel/01-types.md")!;
		expect(types.status).toBe("success");
		expect(types.files.map((f) => f.output.path)).toEqual(["_export/excel/excel.xlsx"]);
	});

	it("目次シートが先頭で、各シートへのリンクがある（D-1c）", () => {
		const names = wb.worksheets.slice().sort((a, b) => (a as unknown as { orderNo: number }).orderNo - (b as unknown as { orderNo: number }).orderNo).map((w) => w.name);
		expect(names[0]).toBe("目次");
		expect(names).toContain("01-types");
		expect(names).toContain(Array.from("05-とても長いノートの名前でシート名の三十一文字の上限を確かめる").slice(0, 31).join(""));
		const toc = sheet("目次");
		expect(toc.getCell("A2").value).toEqual({ text: "01-types", hyperlink: "#'01-types'!A1" });
		expect(toc.getCell("B2").value).toBe("excel/01-types.md");
		expect(toc.getCell("C2").value).toBe("値の型");
	});

	it("列の型と表示形式（D-2）", () => {
		const s = sheet("01-types");
		// 表題行（1 行目）・見出し行（2 行目）・データ（3 行目から）
		expect(s.getCell("A1").value).toBe("値の型");
		const header = (s.getRow(2).values as unknown[]).slice(1);
		expect(header[0]).toBe("名前");
		const col = (name: string) => header.indexOf(name) + 1;
		const v = (name: string, row = 3) => s.getCell(row, col(name));
		expect(v("整数").value).toBe(1);
		expect(v("桁区切り").value).toBe(1200);
		expect(v("桁区切り").numFmt).toBe("#,##0");
		expect(v("率").value).toBeCloseTo(0.12);
		expect(v("率").numFmt).toBe("0.0%");
		expect(v("円").numFmt).toBe('"¥"#,##0');
		expect(v("ドル").value).toBe(3.5);
		expect(v("円（後ろ）").value).toBe(980);
		expect((v("日付").value as Date).toISOString()).toBe("2026-11-18T00:00:00.000Z");
		expect(v("日時").numFmt).toBe("yyyy-mm-dd hh:mm");
		expect(v("真偽値").value).toBe(true);
		for (const name of ["郵便番号", "電話番号", "先頭ゼロ", "長い数字", "混在"]) expect(typeof v(name).value, name).toBe("string");
		expect(v("空あり", 4).value).toBeNull();
		expect(v("空あり", 5).value).toBe(7);
		// 右揃えの列（---:）
		expect(v("整数").alignment?.horizontal).toBe("right");
	});

	it("表が 1 つのシートは見出し行で固定し、列の多いシートは横向き（D-3・D-5）", () => {
		const s = sheet("01-types");
		expect(s.views[0]).toMatchObject({ state: "frozen", ySplit: 2 });
		expect(s.pageSetup.orientation).toBe("landscape");
		expect(s.pageSetup.printTitlesRow).toBe("1:2");
		expect(s.pageSetup.fitToWidth).toBe(1);
	});

	it("複数の表は縦に並べ、直前の見出しを表題行にする。引用・コールアウト・埋め込みの表も取り出す（A-31）", () => {
		const s = sheet("02-multi-tables");
		const texts: string[] = [];
		let emptyColumnRow = 0;
		s.eachRow((row, n) => {
			texts.push(String(row.getCell(1).value ?? ""));
			if (row.getCell(1).value === "列1") emptyColumnRow = n;
		});
		expect(texts).toEqual(["見出しの前の表", "表題行なし", "東日本", "店舗", "札幌", "仙台", "西日本", "店舗", "大阪", "福岡", "コールアウトの中の表", "項目", "A", "埋め込んだノートの表", "埋め込みの表", "x", "y", "列名が空・重複", "列1", "1"]);
		// 表と表の間は空行（eachRow は空の行を飛ばすので、行番号で確かめる）
		expect(s.getRow(3).getCell(1).value).toBeNull();
		// 表が複数あるシートは固定しない
		expect((s.views ?? [])[0]?.state).not.toBe("frozen");
		// 列名の重複は (2)
		expect(s.getCell(`C${emptyColumnRow}`).value).toBe("名前 (2)");
		// 表ごとに別の Excel テーブル
		expect(Object.keys((s as unknown as { tables: Record<string, unknown> }).tables).length).toBe(6);
	});

	it("セルの書式・リンク・画像・数式インジェクション（A-32・A-33・D-2）", () => {
		const s = sheet("03-cell-format");
		const row = (label: string) => {
			let found = 0;
			s.eachRow((r, n) => {
				if (r.getCell(1).value === label) found = n;
			});
			return s.getCell(found, 2);
		};
		const rich = row("強調").value as { richText: { text: string; font?: Record<string, unknown> }[] };
		expect(rich.richText.map((r) => r.text).join("")).toBe("太字と斜体と取り消しとハイライト");
		expect(rich.richText.find((r) => r.text === "太字")!.font).toMatchObject({ bold: true });
		expect(rich.richText.find((r) => r.text === "斜体")!.font).toMatchObject({ italic: true });
		expect(rich.richText.find((r) => r.text === "取り消し")!.font).toMatchObject({ strike: true });
		expect((row("コード").value as { richText: { font?: { name?: string } }[] }).richText[0]!.font!.name).toBe("Consolas");
		expect(row("数式").value).toBe("E = mc^2");
		expect(row("改行").value).toBe("1 行目\n2 行目");
		expect(row("改行").alignment?.wrapText).toBe(true);
		expect(row("外部リンク").value).toEqual({ text: "Obsidian", hyperlink: "https://obsidian.md" });
		expect(row("同じブックのノート").value).toEqual({ text: "01-types", hyperlink: "#'01-types'!A1" });
		expect((row("ブックの外のノート").value as { hyperlink: string }).hyperlink).toBe("obsidian://open?vault=test-vault&file=word3a%2F01-internal-links.md");
		expect(row("リンクが 2 つ").value).toEqual({ text: "1 つ目 と 2 つ目", hyperlink: "https://example.com/1" });
		expect(row("画像").value).toBeNull();
		expect(s.getImages()).toHaveLength(1);
		// = や + で始まる値も文字列（数式にしない）
		expect(row("数式の形の文字").value).toBe("=SUM(A1:A3)");
		expect(row("数式の形の文字").type).toBe(3); // ValueType.String
		expect(row("符号の形の文字").value).toBe("+81 と -abc と @user");
	});

	it("ブックのプロパティ: タイトルはフォルダ名、OS のユーザー名を入れない（D-5）", () => {
		expect(wb.title).toBe("excel");
		expect(wb.creator).toBe("Unknown");
	});

	it("マニフェストには、ブックのすべての元ノートを記録する", () => {
		const snapshot = applyResults({ entries: [] }, results, "2026-11-18T00:00:00.000Z");
		const book = snapshot.entries.find((e) => e.output.path === "_export/excel/excel.xlsx")!;
		expect(book.sources).toEqual(["excel/01-types.md", "excel/02-multi-tables.md", "excel/03-cell-format.md", "excel/05-とても長いノートの名前でシート名の三十一文字の上限を確かめる.md"]);
		expect(book.kind).toBe("xlsx");
	});
});

describe("設定による違い", () => {
	it("単一ノートは {ノート名}.xlsx で、目次シートを作らない", async () => {
		const { writer, results } = await convertFolder(["excel/01-types.md"]);
		expect([...writer.files.keys()]).toEqual(["vault:_export/excel/01-types.xlsx"]);
		expect(results[0]!.status).toBe("success");
		const wb = await load(writer.files.get("vault:_export/excel/01-types.xlsx")!);
		expect(wb.worksheets.map((w) => w.name)).toEqual(["01-types"]);
		expect(wb.title).toBe("01-types");
	});

	it("1 表 = 1 シート: シート名は直前の見出し、なければ「表 n」。表題行は置かない", async () => {
		const { writer } = await convertFolder(["excel/02-multi-tables.md"], { excelSheetUnit: "perTable" });
		const wb = await load(writer.files.get("vault:_export/excel/02-multi-tables.xlsx")!);
		const names = wb.worksheets.map((w) => w.name);
		expect(names).toEqual(["目次", "表 1", "東日本", "西日本", "コールアウトの中の表", "埋め込んだノートの表", "列名が空・重複"]);
		const east = wb.getWorksheet("東日本")!;
		expect(east.getCell("A1").value).toBe("店舗");
		expect(east.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
	});

	it("1 ノート = 1 ブック・Excel テーブルにしない", async () => {
		const { writer } = await convertFolder(["excel/01-types.md", "excel/03-cell-format.md"], { excelBookUnit: "perNote", excelAsTable: false });
		expect([...writer.files.keys()].sort()).toEqual(["vault:_export/excel/01-types.xlsx", "vault:_export/excel/03-cell-format.xlsx"]);
		const wb = await load(writer.files.get("vault:_export/excel/01-types.xlsx")!);
		const s = wb.worksheets[0]!;
		expect(Object.keys((s as unknown as { tables: Record<string, unknown> }).tables)).toHaveLength(0);
		expect(s.getCell("A2").font).toMatchObject({ bold: true });
		expect(s.getCell("A2").fill).toMatchObject({ type: "pattern" });
		// 1 ノート = 1 ブックでは、もう一方のノートは別のブックなので obsidian:// へのリンク
		const other = await load(writer.files.get("vault:_export/excel/03-cell-format.xlsx")!);
		let link: unknown;
		other.worksheets[0]!.eachRow((r) => {
			if (r.getCell(1).value === "同じブックのノート") link = r.getCell(2).value;
		});
		expect((link as { hyperlink: string }).hyperlink).toMatch(/^obsidian:\/\/open\?/);
	});

	it("タイムアウトしたノートのシートは足さない", async () => {
		const writer = new MemoryWriter();
		const run = new XlsxRun(DEFAULT_SETTINGS, ["excel/01-types.md", "excel/03-cell-format.md"], {
			readNote: async (p) => readFileSync(join(VAULT_DIR, p), "utf8"),
			writer,
			labels: LABELS,
		});
		const aborted = new AbortController();
		aborted.abort(new Error("timeout"));
		await expect(run.addNote("excel/01-types.md", aborted.signal)).rejects.toThrow("timeout");
		const results = [await run.addNote("excel/03-cell-format.md", new AbortController().signal)];
		await run.finish(results);
		const wb = await load(writer.files.get("vault:_export/excel/excel.xlsx")!);
		expect(wb.worksheets.map((w) => w.name)).toEqual(["03-cell-format"]);
	});
});
