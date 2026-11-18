// .xlsx の組み立て（08: .xlsx の生成・フェーズ 4a）。Obsidian API に依存しない。
// 組み立て済みの mdast から表を取り出し（A-30・A-31）、ブックにシートを足していき（D-1）、最後に目次・リンク先・プロパティを決めて完成させる。
import { Workbook, type Cell, type CellRichTextValue, type Worksheet } from "exceljs";
import type { PhrasingContent, Root, RootContent, Table } from "mdast";
import type { ImageAsset } from "./obsidian-syntax";
import type { OutlineRow } from "./xlsx-outline";
import type { Warning } from "./types";
import {
	CELL_TEXT_MAX,
	LANDSCAPE_TOTAL_WIDTH,
	columnWidth,
	convertCell,
	detectColumnType,
	displayWidth,
	sheetLink,
	tableName,
	uniqueColumnNames,
	uniqueSheetName,
	type ColumnType,
} from "./xlsx-values";

/** 内部リンクを「ブックを完成させるときに決める」ための URL の形（同じブックのシートか obsidian://: A-32） */
export const NOTE_LINK_SCHEME = "boe-note:";

/** 取り出した表 1 つ（A-31）。 */
export interface XlsxTable {
	/** 直前の見出し（なければ undefined） */
	title?: string;
	align: (Table["align"] extends (infer A)[] | null | undefined ? A : never)[];
	header: PhrasingContent[][];
	rows: PhrasingContent[][][];
}

/** 画面の言語に合わせた文字（目次シートなど）。 */
export interface XlsxLabels {
	toc: string;
	sheet: string;
	source: string;
	heading: string;
	tableCount: string;
	/** 空の列名（Excel テーブルの列名は空にできない） */
	column(index: number): string;
	/** 1 表 = 1 シートで、直前の見出しがない表のシート名 */
	table(index: number): string;
	/** アウトライン形式の「本文」の列（A-30） */
	body: string;
}

export interface XlsxBookOptions {
	sheetUnit: "perNote" | "perTable";
	asTable: boolean;
	labels: XlsxLabels;
	/** ブックの外のノートへのリンク（元ノートを開く obsidian://open） */
	noteUri(notePath: string): string;
	/** 各表の左に「元ノート」「見出し」の列を足す（D-5 のオプション） */
	sourceColumns?: boolean;
}

export interface NoteSheetsInput {
	notePath: string;
	/** 1 ノート = 1 シートのシート名の元（ノート名） */
	noteName: string;
	/** ノートの最初の見出し（目次の「見出し」） */
	firstHeading?: string;
	tables: XlsxTable[];
}

/** アウトライン形式のシート 1 枚分（A-30 のオプション）。 */
export interface NoteOutlineInput {
	notePath: string;
	noteName: string;
	firstHeading?: string;
	rows: OutlineRow[];
}

interface Run {
	text: string;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	underline?: boolean;
	code?: boolean;
}

/** セル 1 つ分の中身（A-32・A-33）。 */
interface CellContent {
	text: string;
	runs: Run[];
	link?: string;
	image?: ImageAsset;
}

interface TocEntry {
	sheet: string;
	notePath: string;
	heading: string;
	tables: number;
}

interface PendingLink {
	sheet: Worksheet;
	address: string;
	text: string;
	notePath: string;
}

const HEADER_FILL = "FFF2F2F2";
const BORDER_COLOR = "FFBFBFBF";
const LINK_COLOR = "FF0563C1";
const CODE_FONT = "Consolas";
/** セルに置く画像の幅の上限（px: A-33） */
const IMAGE_MAX_WIDTH = 200;

/** ノートの表を取り出す（A-31）。引用・コールアウト・リスト・埋め込みの中にも降り、表の中には降りない。直前の見出し（コールアウトの中ではそのタイトル）を表題にする。 */
export function tablesOf(tree: Root): XlsxTable[] {
	const tables: XlsxTable[] = [];
	let title: string | undefined;
	const visit = (node: RootContent | Root): void => {
		if (node.type === "heading") {
			title = plainText(node.children).trim() || undefined;
			return;
		}
		// コールアウトのタイトルも、中の表の表題にする（フェーズ 4 の決定）
		if (node.type === "callout") title = plainText(node.title).trim() || title;
		if (node.type === "table") {
			const [head, ...body] = node.children;
			if (!head) return;
			tables.push({
				...(title !== undefined ? { title } : {}),
				align: head.children.map((_, i) => node.align?.[i] ?? null),
				header: head.children.map((c) => c.children),
				rows: body.map((r) => head.children.map((_, i) => r.children[i]?.children ?? [])),
			});
			return;
		}
		if ("children" in node && Array.isArray(node.children)) for (const child of node.children as RootContent[]) visit(child);
	};
	visit(tree);
	return tables;
}

/** ノートの最初の見出し（目次の「見出し」: D-1c）。 */
export function firstHeading(tree: Root): string | undefined {
	let found: string | undefined;
	const visit = (node: RootContent | Root): boolean => {
		if (node.type === "heading") {
			found = plainText(node.children).trim() || undefined;
			return found !== undefined;
		}
		if (node.type === "table") return false;
		if ("children" in node && Array.isArray(node.children)) return (node.children as RootContent[]).some(visit);
		return false;
	};
	visit(tree);
	return found;
}

/** インラインノードの表示テキスト。 */
export function plainText(nodes: readonly PhrasingContent[]): string {
	return cellContent(nodes).text;
}

/** セルのインラインノードを、文字・書式の断片・最初のリンク・最初の画像にする（A-32・A-33）。 */
function cellContent(nodes: readonly PhrasingContent[]): CellContent {
	const out: CellContent = { text: "", runs: [] };
	const push = (text: string, format: Omit<Run, "text">) => {
		if (text === "") return;
		out.text += text;
		out.runs.push({ text, ...format });
	};
	const walk = (list: readonly PhrasingContent[], format: Omit<Run, "text">) => {
		for (const node of list) {
			switch (node.type) {
				case "text":
					push(node.value, format);
					break;
				case "strong":
					walk(node.children, { ...format, bold: true });
					break;
				case "emphasis":
					walk(node.children, { ...format, italic: true });
					break;
				case "delete":
					walk(node.children, { ...format, strike: true });
					break;
				case "inlineCode":
					push(node.value, { ...format, code: true });
					break;
				case "inlineMath":
					// 数式は LaTeX のまま（A-33）
					push(node.value, format);
					break;
				case "break":
					push("\n", format);
					break;
				case "html":
					if (/^<br\s*\/?>$/i.test(node.value.trim())) push("\n", format);
					break;
				case "link":
					if (out.link === undefined) out.link = node.url;
					walk(node.children, format);
					break;
				case "embedImage": {
					const image = node.data?.image;
					if (image && out.image === undefined) out.image = image;
					else push(node.alt, format);
					break;
				}
				case "image":
					push(node.alt ?? "", format);
					break;
				case "htmlFormat":
					// ハイライト（mark）は文字単位で表せないので無視する（A-32）。下線だけは書式にする
					walk(node.children, node.tag === "u" ? { ...format, underline: true } : format);
					break;
				case "footnoteReference":
				case "inlineFootnote":
				case "commentMark":
					break;
				default:
					if ("children" in node && Array.isArray(node.children)) walk(node.children as PhrasingContent[], format);
					else if ("value" in node && typeof node.value === "string") push(node.value, format);
			}
		}
	};
	walk(nodes, {});
	return out;
}

/**
 * ブック 1 つ分の状態（グループ: 1 フォルダ = 1 ブック / 1 ノート = 1 ブック / 単一ノート）。
 * ノートごとに addNote でシートを足し、finish で完成させる。
 */
export class XlsxBook {
	private readonly workbook = new Workbook();
	private readonly usedNames = new Set<string>();
	private readonly toc: TocEntry[] = [];
	private readonly pendingLinks: PendingLink[] = [];
	/** ノート → そのノートの最初のシート名（同じブックの中のリンク先: A-32） */
	private readonly noteSheets = new Map<string, string>();
	private tableCount = 0;

	constructor(private readonly options: XlsxBookOptions) {}

	get sheetCount(): number {
		return this.workbook.worksheets.length;
	}

	/** ノートの表をシートにして足す。途中で例外が出たら、このノートで足したシートを取り除いてから投げる（08 の決定）。 */
	addNote(input: NoteSheetsInput): Warning[] {
		const tables = this.options.sourceColumns ? input.tables.map((t) => this.withSourceColumns(t, input.notePath)) : input.tables;
		const groups =
			this.options.sheetUnit === "perNote"
				? [{ name: input.noteName, tables }]
				: tables.map((table, i) => ({ name: table.title ?? this.options.labels.table(i + 1), tables: [table] }));
		return this.transaction(input.notePath, (warnings, addSheet) => {
			for (const group of groups) {
				const sheet = addSheet(group.name);
				warnings.push(...this.writeSheet(sheet, group.tables, input.notePath));
				this.toc.push({ sheet: sheet.name, notePath: input.notePath, heading: input.firstHeading ?? "", tables: group.tables.length });
			}
		});
	}

	/** ノートの本文をアウトライン形式のシートにして足す（A-30 のオプション）。 */
	addOutlineNote(input: NoteOutlineInput): Warning[] {
		return this.transaction(input.notePath, (warnings, addSheet) => {
			const sheet = addSheet(input.noteName);
			warnings.push(...this.writeOutline(sheet, input.rows, input.notePath));
			this.toc.push({ sheet: sheet.name, notePath: input.notePath, heading: input.firstHeading ?? "", tables: input.rows.filter((r) => r.kind === "table").length });
		});
	}

	/** ノート 1 件分のシートを足す。途中で例外が出たら、足したシート・名前・リンク・目次の行を元に戻してから投げる。 */
	private transaction(notePath: string, write: (warnings: Warning[], addSheet: (name: string) => Worksheet) => void): Warning[] {
		const added: Worksheet[] = [];
		const namesBefore = new Set(this.usedNames);
		const tableCountBefore = this.tableCount;
		const pendingBefore = this.pendingLinks.length;
		const tocBefore = this.toc.length;
		const warnings: Warning[] = [];
		try {
			write(warnings, (name) => {
				const sheet = this.workbook.addWorksheet(uniqueSheetName(name, this.usedNames));
				added.push(sheet);
				return sheet;
			});
			if (added[0] && !this.noteSheets.has(notePath)) this.noteSheets.set(notePath, added[0].name);
			return warnings;
		} catch (error) {
			for (const sheet of added) this.workbook.removeWorksheet(sheet.id);
			this.usedNames.clear();
			for (const n of namesBefore) this.usedNames.add(n);
			this.tableCount = tableCountBefore;
			this.pendingLinks.length = pendingBefore;
			this.toc.length = tocBefore;
			throw error;
		}
	}

	/** 表の左に「元ノート」（元ノートを開くリンク）と「見出し」の列を足す（D-5 のオプション）。 */
	private withSourceColumns(table: XlsxTable, notePath: string): XlsxTable {
		const { labels } = this.options;
		const source: PhrasingContent = { type: "link", url: this.options.noteUri(notePath), title: null, children: [{ type: "text", value: notePath }] };
		const heading: PhrasingContent[] = table.title !== undefined ? [{ type: "text", value: table.title }] : [];
		return {
			...table,
			align: [null, null, ...table.align],
			header: [[{ type: "text", value: labels.source }], [{ type: "text", value: labels.heading }], ...table.header],
			rows: table.rows.map((r) => [[source], heading, ...r]),
		};
	}

	/** 目次・リンク先・プロパティを決めて、.xlsx のバイト列にする。 */
	async finish(props: { title: string; creator: string }): Promise<Uint8Array> {
		for (const link of this.pendingLinks) {
			const target = this.noteSheets.get(link.notePath);
			setLink(link.sheet.getCell(link.address), link.text, target !== undefined ? sheetLink(target) : this.options.noteUri(link.notePath));
		}
		if (this.workbook.worksheets.length >= 2) this.writeToc();
		this.workbook.title = props.title;
		// exceljs は作成者が空だと "Unknown" を書く（OS のユーザー名は使わない: D-5・R3）
		this.workbook.creator = props.creator;
		this.workbook.lastModifiedBy = props.creator;
		const now = new Date();
		this.workbook.created = now;
		this.workbook.modified = now;
		return toBytes(await this.workbook.xlsx.writeBuffer());
	}

	private writeToc(): void {
		const { labels } = this.options;
		const name = uniqueSheetName(labels.toc, this.usedNames);
		const sheet = this.workbook.addWorksheet(name);
		// 先頭に置く（D-1c）。orderNo は exceljs の型定義にないが、シートの並び順に使われる
		(sheet as unknown as { orderNo: number }).orderNo = -1;
		const header = [labels.sheet, labels.source, labels.heading, labels.tableCount];
		const widths = header.map(displayWidth);
		header.forEach((text, i) => {
			const cell = sheet.getCell(1, i + 1);
			cell.value = text;
			styleHeaderCell(cell);
		});
		this.toc.forEach((entry, r) => {
			const row = r + 2;
			setLink(sheet.getCell(row, 1), entry.sheet, sheetLink(entry.sheet));
			sheet.getCell(row, 2).value = entry.notePath;
			sheet.getCell(row, 3).value = entry.heading;
			sheet.getCell(row, 4).value = entry.tables;
			[entry.sheet, entry.notePath, entry.heading, String(entry.tables)].forEach((t, i) => (widths[i] = Math.max(widths[i]!, displayWidth(t))));
		});
		widths.forEach((w, i) => (sheet.getColumn(i + 1).width = columnWidth(w).width));
		sheet.views = [{ state: "frozen", ySplit: 1 }];
		sheet.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
	}

	/** シート 1 枚に表を縦に並べる（A-31・D-3・D-5）。 */
	private writeSheet(sheet: Worksheet, tables: readonly XlsxTable[], notePath: string): Warning[] {
		const warnings: Warning[] = [];
		const widths: number[] = [];
		const wrapColumns = new Set<number>();
		const withTitle = this.options.sheetUnit === "perNote";
		let row = 1;
		let headerRowOfOnlyTable = 0;
		const measure = (col: number, text: string) => (widths[col] = Math.max(widths[col] ?? 0, displayWidth(text)));

		tables.forEach((table, t) => {
			if (t > 0) row++; // 表と表の間は空行（A-31）
			if (withTitle && table.title !== undefined) {
				const cell = sheet.getCell(row, 1);
				cell.value = table.title;
				cell.font = { bold: true, size: 12 };
				row++;
			}
			const headerRow = row;
			const names = uniqueColumnNames(table.header.map((c) => plainText(c)), (i) => this.options.labels.column(i));
			names.forEach((n, c) => measure(c, n));
			const contents = table.rows.map((r) => r.map((c) => cellContent(c)));
			const types: ColumnType[] = names.map((_, c) => detectColumnType(contents.map((r) => (r[c]?.image ? "" : (r[c]?.text ?? "")))));

			// 値を決める（型・リッチテキスト・リンク）。リンクとセルの中の画像は、セルを書いた後に付ける
			const values = contents.map((r, ri) =>
				names.map((_, c) => {
					const content = r[c] ?? { text: "", runs: [] };
					measure(c, content.text);
					return cellValue(content, types[c]!, (detail) => warnings.push({ code: "cellTruncated", detail: `${notePath}: ${sheet.name}!${columnLetter(c)}${headerRow + 1 + ri}${detail}` }));
				}),
			);
			const rows = values.length > 0 ? values : [names.map(() => null)];

			if (this.options.asTable) {
				this.tableCount++;
				sheet.addTable({
					name: tableName(this.tableCount),
					ref: `A${headerRow}`,
					headerRow: true,
					style: { theme: "TableStyleMedium2", showRowStripes: true },
					columns: names.map((name) => ({ name, filterButton: true })),
					rows,
				});
				names.forEach((_, c) => (sheet.getCell(headerRow, c + 1).font = { bold: true }));
			} else {
				names.forEach((name, c) => {
					const cell = sheet.getCell(headerRow, c + 1);
					cell.value = name;
					styleHeaderCell(cell);
				});
				rows.forEach((r, ri) =>
					r.forEach((v, c) => {
						const cell = sheet.getCell(headerRow + 1 + ri, c + 1);
						cell.value = v;
						cell.border = thinBorder();
					}),
				);
			}

			// 表示形式・配置・リンク・画像
			contents.forEach((r, ri) =>
				names.forEach((_, c) => {
					const content = r[c];
					if (!content) return;
					const address = `${columnLetter(c)}${headerRow + 1 + ri}`;
					const cell = sheet.getCell(address);
					const type = types[c]!;
					if (type.numFmt && typeof cell.value !== "string" && cell.value !== null) cell.numFmt = type.numFmt;
					if (content.text.includes("\n")) wrapColumns.add(c);
					this.applyLink(sheet, address, content);
					if (content.image) this.placeImage(sheet, content.image, headerRow + ri, c, (px) => (widths[c] = Math.max(widths[c] ?? 0, px)));
				}),
			);
			for (let r = headerRow; r <= headerRow + rows.length; r++)
				names.forEach((_, c) => {
					const cell = sheet.getCell(r, c + 1);
					const horizontal = table.align[c] ?? undefined;
					cell.alignment = { ...(horizontal ? { horizontal } : {}), vertical: "top", ...(wrapColumns.has(c) ? { wrapText: true } : {}) };
				});
			if (tables.length === 1) headerRowOfOnlyTable = headerRow;
			row = headerRow + rows.length + 1;
		});

		// 列幅（同じ列にあるすべての表の最大: D-3）
		let total = 0;
		widths.forEach((w, c) => {
			const { width, wrap } = columnWidth(w);
			sheet.getColumn(c + 1).width = width;
			total += width;
			if (wrap) for (let r = 1; r < row; r++) sheet.getCell(r, c + 1).alignment = { ...sheet.getCell(r, c + 1).alignment, wrapText: true };
		});
		// ウィンドウ枠の固定と印刷タイトルは、表が 1 つのときだけ（D-3・D-5）
		if (headerRowOfOnlyTable > 0) {
			sheet.views = [{ state: "frozen", ySplit: headerRowOfOnlyTable }];
		}
		sheet.pageSetup = {
			paperSize: 9,
			orientation: total > LANDSCAPE_TOTAL_WIDTH ? "landscape" : "portrait",
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
			...(headerRowOfOnlyTable > 0 ? { printTitlesRow: `1:${headerRowOfOnlyTable}` } : {}),
		};
		return warnings;
	}

	/** セルの最初のリンクを付ける。ノートへのリンクは、ブックを完成させるときに決める（A-32）。 */
	private applyLink(sheet: Worksheet, address: string, content: CellContent): void {
		if (content.link === undefined) return;
		if (content.link.startsWith(NOTE_LINK_SCHEME)) {
			this.pendingLinks.push({ sheet, address, text: content.text, notePath: content.link.slice(NOTE_LINK_SCHEME.length) });
		} else if (!content.link.startsWith("#")) setLink(sheet.getCell(address), content.text, content.link);
	}

	/**
	 * アウトライン形式のシート（A-30 のオプション）。列は H1・H2・H3・本文。1 段落 / 1 リスト項目 = 1 行。
	 * 表は本文の列から右へ並べ、表ごとに型を判定する。見出しの下の行を Excel の行のグループ化で折りたためるようにする。
	 */
	private writeOutline(sheet: Worksheet, rows: readonly OutlineRow[], notePath: string): Warning[] {
		const warnings: Warning[] = [];
		const header = ["H1", "H2", "H3", this.options.labels.body];
		const BODY = 4;
		const widths = header.map(displayWidth);
		const measure = (col: number, text: string) => (widths[col - 1] = Math.max(widths[col - 1] ?? 0, displayWidth(text)));
		header.forEach((text, i) => {
			const cell = sheet.getCell(1, i + 1);
			cell.value = text;
			styleHeaderCell(cell);
		});
		const truncated = (address: string) => (detail: string) => warnings.push({ code: "cellTruncated", detail: `${notePath}: ${sheet.name}!${address}${detail}` });
		let r = 2;
		let maxLevel = 0;
		const setLevel = (level: number) => {
			if (level <= 0) return;
			sheet.getRow(r).outlineLevel = level;
			maxLevel = Math.max(maxLevel, level);
		};

		for (const row of rows) {
			switch (row.kind) {
				case "heading": {
					const col = row.depth <= 3 ? row.depth : BODY;
					const content = cellContent(row.content);
					const cell = sheet.getCell(r, col);
					cell.value = content.text;
					cell.font = { bold: true };
					measure(col, content.text);
					setLevel(row.level);
					r++;
					break;
				}
				case "text": {
					const content = cellContent(row.content);
					const address = `${columnLetter(BODY - 1)}${r}`;
					const cell = sheet.getCell(address);
					cell.value = cellValue(content, { kind: "string" }, truncated(address));
					if (row.bold) cell.font = { bold: true };
					if (content.text.includes("\n")) cell.alignment = { vertical: "top", wrapText: true };
					this.applyLink(sheet, address, content);
					measure(BODY, content.text);
					setLevel(row.level);
					r++;
					break;
				}
				case "code": {
					const cell = sheet.getCell(r, BODY);
					cell.value = row.text.length > CELL_TEXT_MAX ? row.text.slice(0, CELL_TEXT_MAX) : row.text;
					if (row.text.length > CELL_TEXT_MAX) truncated(`${columnLetter(BODY - 1)}${r}`)(` (${row.text.length})`);
					cell.font = { name: CODE_FONT };
					cell.alignment = { vertical: "top", wrapText: true };
					measure(BODY, row.text);
					setLevel(row.level);
					r++;
					break;
				}
				case "table": {
					const { table } = row;
					table.header.forEach((h, c) => {
						const cell = sheet.getCell(r, BODY + c);
						cell.value = plainText(h);
						cell.font = { bold: true };
						cell.border = thinBorder();
						measure(BODY + c, plainText(h));
					});
					setLevel(row.level);
					r++;
					const contents = table.rows.map((cells) => cells.map((c) => cellContent(c)));
					const types = table.header.map((_, c) => detectColumnType(contents.map((cells) => cells[c]?.text ?? "")));
					for (const cells of contents) {
						cells.forEach((content, c) => {
							const address = `${columnLetter(BODY - 1 + c)}${r}`;
							const cell = sheet.getCell(address);
							cell.value = cellValue(content, types[c]!, truncated(address));
							if (types[c]!.numFmt && typeof cell.value !== "string" && cell.value !== null) cell.numFmt = types[c]!.numFmt!;
							const horizontal = table.align[c] ?? undefined;
							if (horizontal) cell.alignment = { horizontal };
							cell.border = thinBorder();
							this.applyLink(sheet, address, content);
							measure(BODY + c, content.text);
						});
						setLevel(row.level);
						r++;
					}
					break;
				}
			}
		}

		let total = 0;
		widths.forEach((w, i) => {
			const { width, wrap } = columnWidth(w);
			sheet.getColumn(i + 1).width = width;
			total += width;
			if (wrap) sheet.getColumn(i + 1).alignment = { vertical: "top", wrapText: true };
		});
		sheet.views = [{ state: "frozen", ySplit: 1 }];
		// 見出しの行（まとめの行）は、折りたたむ行の上にある
		sheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
		// exceljs は「行の段 >= シートの outlineLevelRow」の行に collapsed（折りたたみ済みの印）を付けるので、行の段より 1 つ大きくする
		sheet.properties.outlineLevelRow = maxLevel + 1;
		// 「幅を 1 ページに収める」（fitToPage）は付けない。exceljs は sheetPr の中に pageSetUpPr を outlinePr より先に書き、
		// 仕様の順番（outlinePr → pageSetUpPr）と逆になって Excel が開けないため。本文の列は 60 文字分で折り返すので、横にははみ出しにくい
		sheet.pageSetup = {
			paperSize: 9,
			orientation: total > LANDSCAPE_TOTAL_WIDTH ? "landscape" : "portrait",
			printTitlesRow: "1:1",
		};
		return warnings;
	}

	/** セルの左上に画像を置き、幅 200 px を上限に縮め、行の高さと列幅を広げる（A-33）。 */
	private placeImage(sheet: Worksheet, image: ImageAsset, row0: number, col0: number, widenColumn: (chars: number) => void): void {
		const bytes = image.type === "svg" ? image.fallback : image.data;
		const extension = image.type === "svg" ? "png" : image.type === "jpg" ? "jpeg" : image.type;
		if (!bytes || (extension !== "png" && extension !== "jpeg" && extension !== "gif")) return;
		const scale = image.width > IMAGE_MAX_WIDTH ? IMAGE_MAX_WIDTH / image.width : 1;
		const width = Math.max(1, Math.round(image.width * scale));
		const height = Math.max(1, Math.round(image.height * scale));
		const id = this.workbook.addImage({ base64: toBase64(bytes), extension });
		sheet.addImage(id, { tl: { col: col0, row: row0 }, ext: { width, height }, editAs: "oneCell" });
		const r = sheet.getRow(row0 + 1);
		r.height = Math.max(r.height ?? 15, height * 0.75 + 4);
		widenColumn(Math.ceil(width / 7));
	}
}

/** セルの値: 型に変換できれば値、書式があればリッチテキスト、なければ文字列（数式にはしない: D-2）。 */
function cellValue(content: CellContent, type: ColumnType, onTruncate: (detail: string) => void): Cell["value"] {
	if (content.image && content.text === "") return null;
	const converted = convertCell(content.text, type);
	if (converted !== null) return converted;
	if (content.text === "") return null;
	let runs = content.runs;
	if (content.text.length > CELL_TEXT_MAX) {
		onTruncate(` (${content.text.length})`);
		runs = truncateRuns(runs, CELL_TEXT_MAX);
	}
	const text = runs.map((r) => r.text).join("");
	// リンクのあるセルは、リンクを優先して書式を付けない（exceljs では 1 セルで両立できない: A-32）
	const formatted = runs.some((r) => r.bold || r.italic || r.strike || r.underline || r.code);
	if (!formatted || content.link !== undefined) return text;
	const rich: CellRichTextValue = {
		richText: runs.map((r) => ({
			text: r.text,
			font: {
				...(r.bold ? { bold: true } : {}),
				...(r.italic ? { italic: true } : {}),
				...(r.strike ? { strike: true } : {}),
				...(r.underline ? { underline: true } : {}),
				...(r.code ? { name: CODE_FONT } : {}),
			},
		})),
	};
	return rich;
}

function truncateRuns(runs: readonly Run[], max: number): Run[] {
	const out: Run[] = [];
	let left = max;
	for (const run of runs) {
		if (left <= 0) break;
		out.push(run.text.length <= left ? run : { ...run, text: run.text.slice(0, left) });
		left -= run.text.length;
	}
	return out;
}

function setLink(cell: Cell, text: string, hyperlink: string): void {
	cell.value = { text, hyperlink };
	cell.font = { ...cell.font, color: { argb: LINK_COLOR }, underline: true };
}

function styleHeaderCell(cell: Cell): void {
	cell.font = { bold: true };
	cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
	cell.border = thinBorder();
}

function thinBorder(): Cell["border"] {
	const side = { style: "thin" as const, color: { argb: BORDER_COLOR } };
	return { top: side, left: side, bottom: side, right: side };
}

/** 0 始まりの列番号 → 列の文字（A, B, …, Z, AA, …）。 */
export function columnLetter(index: number): string {
	let n = index + 1;
	let s = "";
	while (n > 0) {
		const m = (n - 1) % 26;
		s = String.fromCharCode(65 + m) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

/** exceljs の writeBuffer は実行環境によって Buffer / Uint8Array / ArrayBuffer を返すので、Uint8Array にそろえる。 */
function toBytes(data: unknown): Uint8Array {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
	throw new TypeError("exceljs returned an unexpected buffer type");
}
