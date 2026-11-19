// .docx のレンダラ（07: .docx の生成・G2・G3・R5・R6）。mdast → docx ライブラリのオブジェクト → バイト列。
// Obsidian API に依存しない。フェーズ 2 の範囲（見出し・段落・改行・リスト・タスク・表・文字書式・Mermaid・引用・コード・水平線・外部リンク）に、
// フェーズ 3a の内部リンクとブックマーク・画像・コールアウト・コードの色付け・脚注・コメント・インライン HTML・改ページ・文書プロパティを足した。
// フェーズ 3b で数式（OMML: A-11）・外部の画像・コールアウトのテーマ色を足した。それ以外の記法は元の Markdown を等幅で残す（A-0b）。
import {
	AlignmentType,
	Bookmark,
	BorderStyle,
	CommentRangeEnd,
	CommentRangeStart,
	CommentReference,
	Document,
	Footer,
	Header,
	PageNumber,
	SequentialIdentifier,
	TableOfContents,
	ExternalHyperlink,
	FootnoteReferenceRun,
	HeadingLevel,
	ImageRun,
	InternalHyperlink,
	LevelFormat,
	LevelSuffix,
	Math as DocxMath,
	Packer,
	PageBreak as DocxPageBreak,
	PageOrientation,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableLayoutType,
	TableRow,
	TextRun,
	WidthType,
	convertMillimetersToTwip,
	type ILevelsOptions,
	type IParagraphStyleOptions,
	type IStylesOptions,
	type IThemeOptions,
	type IParagraphOptions,
	type ParagraphChild,
} from "docx";
import { latexToMath } from "docx/math";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { BlockContent, Code, FootnoteDefinition, Heading, List, ListItem, PhrasingContent, Root, RootContent, Table as MdTable } from "mdast";
import { styleIds } from "./docx-template";
import { walk } from "./markdown";
import type { Callout, CodeToken, EmbedImage, ImageAsset } from "./obsidian-syntax";
import { timed, timedSync } from "./profile";

export interface DiagramAsset {
	svg: Uint8Array;
	png: Uint8Array;
	/** 描画したときの大きさ（CSS ピクセル = 96 dpi） */
	width: number;
	height: number;
}

export interface PageSettings {
	paperSize: "A4" | "B5" | "Letter";
	orientation: "portrait" | "landscape";
	marginsMm: { top: number; bottom: number; left: number; right: number };
}

export interface FontSettings {
	bodyEastAsia: string;
	bodyLatin: string;
	headingEastAsia: string;
	headingLatin: string;
}

/** 文書プロパティ（A-27）。 */
export interface DocumentProperties {
	keywords?: string;
	/** 作成日時（dcterms:created） */
	created?: Date;
	/** ユーザー設定のプロパティ（docProps/custom.xml） */
	custom?: { name: string; value: string }[];
}

export interface DocxRenderOptions {
	/** 文書プロパティのタイトル（frontmatter の title、なければノート名） */
	title: string;
	/** 文書プロパティの作成者。空なら空のまま（OS のユーザー名は入れない: R3） */
	creator: string;
	/** Obsidian の「厳密な改行」。false なら段落内の改行を w:br にする（A-2） */
	strictLineBreaks: boolean;
	/** 見出しを 1 段下げ、ノート名を「表題」にする（A-1 のオプション） */
	fileNameAsTitle: boolean;
	page: PageSettings;
	fonts: FontSettings;
	/** Mermaid の図。キーは連番（markMermaid） */
	diagrams: ReadonlyMap<number, DiagramAsset>;
	/** 元の Markdown（未対応の記法を原文で残すため: A-0b） */
	source: string;
	/** コードの行番号（A-7 のオプション） */
	codeLineNumbers?: boolean;
	/** Word のコメントにするコメントの中身（A-16 のオプション）。commentMark の id が添字 */
	comments?: readonly string[];
	properties?: DocumentProperties;
	/** 冒頭に出すプロパティの表（A-27 のオプション） */
	propertiesTable?: readonly [string, string][];
	/** フッター中央のページ番号「n / 総ページ数」（C-5） */
	footerPageNumber?: boolean;
	/** ヘッダーに文書のタイトル（C-5） */
	headerTitle?: boolean;
	/** 表紙（C-8）。表紙のページにはヘッダー・フッターを出さない */
	cover?: { title: string; author?: string; date: string };
	/** 目次（C-4a）の見出しの文字。なければ目次を入れない */
	tableOfContents?: string;
	/** テンプレート（C-1b）の styles.xml とテーマ。あればテンプレートのスタイルを使い、ないスタイルだけ内蔵のものを補う */
	template?: { styles: string; theme?: IThemeOptions };
	/** 見出しの段落番号「1」「1.1」…（C-1c） */
	headingNumbering?: boolean;
	/** 見出し 1 の前で改ページ（C-2） */
	pageBreakBeforeH1?: boolean;
	/** 表を本文の幅いっぱいにする（C-6） */
	tableFullWidth?: boolean;
	/** 図表番号（R4・C-4b）の「図」「表」の文字。なければ付けない */
	captions?: { figure?: string; table?: string };
}

/** 用紙の大きさ（mm、縦向き）。B5 は JIS B5。 */
const PAPER_MM: Record<PageSettings["paperSize"], { width: number; height: number }> = {
	A4: { width: 210, height: 297 },
	B5: { width: 182, height: 257 },
	Letter: { width: 215.9, height: 279.4 },
};

const MONO_FONT = { ascii: "Consolas", hAnsi: "Consolas", eastAsia: "MS Gothic", cs: "Consolas" };
const CODE_SHADING = { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" };
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const BULLETS = ["•", "◦", "▪"];
const LIST_INDENT_TWIP = 360;
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" };

/** コールアウトの既定色（Obsidian の既定のテーマの色。A-6・フェーズ 3 の決定事項）。 */
const CALLOUT_COLORS: Readonly<Record<string, string>> = (() => {
	const groups: [string, string[]][] = [
		["086DDD", ["note", "info", "todo"]],
		["00BFBC", ["abstract", "summary", "tldr", "tip", "hint", "important"]],
		["08B94E", ["success", "check", "done"]],
		["EC7500", ["question", "help", "faq", "warning", "caution", "attention"]],
		["E93147", ["failure", "fail", "missing", "danger", "error", "bug"]],
		["7852EE", ["example"]],
		["9E9E9E", ["quote", "cite"]],
	];
	const map: Record<string, string> = {};
	for (const [color, types] of groups) for (const type of types) map[type] = color;
	return map;
})();

/** コールアウトの色（未知の種類は note の色）。 */
export function calloutColor(type: string): string {
	return CALLOUT_COLORS[type] ?? CALLOUT_COLORS.note;
}

/** 背景の淡い色（白と 10% だけ混ぜる）。 */
export function lightColor(hex: string): string {
	return [0, 2, 4]
		.map((i) => {
			const c = parseInt(hex.slice(i, i + 2), 16);
			return Math.round(255 - (255 - c) * 0.1)
				.toString(16)
				.padStart(2, "0");
		})
		.join("")
		.toUpperCase();
}

/** コードの色付けの配色（Prism のトークンの種類 → 色。A-7・フェーズ 3 の決定事項: 固定の配色）。 */
const TOKEN_COLORS: Readonly<Record<string, string>> = {
	comment: "6A737D",
	prolog: "6A737D",
	doctype: "6A737D",
	cdata: "6A737D",
	keyword: "D73A49",
	atrule: "D73A49",
	important: "D73A49",
	rule: "D73A49",
	string: "032F62",
	char: "032F62",
	"attr-value": "032F62",
	regex: "032F62",
	"template-string": "032F62",
	url: "032F62",
	number: "005CC5",
	boolean: "005CC5",
	constant: "005CC5",
	symbol: "005CC5",
	"attr-name": "005CC5",
	property: "005CC5",
	function: "6F42C1",
	"class-name": "6F42C1",
	tag: "22863A",
	selector: "22863A",
	inserted: "22863A",
	deleted: "B31D28",
	builtin: "E36209",
	variable: "E36209",
	namespace: "E36209",
};

/** トークンの色。内側の種類から順に配色を探す。 */
export function tokenColor(types: readonly string[]): string | undefined {
	for (let i = types.length - 1; i >= 0; i--) {
		const color = TOKEN_COLORS[types[i]];
		if (color) return color;
	}
	return undefined;
}

/** 本文の領域の大きさ（CSS ピクセル）。画像を収める大きさ（R4・フェーズ 2 の決定事項）。 */
export function bodyArea(page: PageSettings): { width: number; height: number } {
	const paper = PAPER_MM[page.paperSize];
	const [w, h] = page.orientation === "landscape" ? [paper.height, paper.width] : [paper.width, paper.height];
	const mmToPx = (mm: number) => (mm / 25.4) * 96;
	return { width: mmToPx(w - page.marginsMm.left - page.marginsMm.right), height: mmToPx(h - page.marginsMm.top - page.marginsMm.bottom) };
}

/** 画像の大きさを本文の領域に収める。縦横比を保ち、小さい画像は拡大しない（R4）。 */
export function fitImage(width: number, height: number, area: { width: number; height: number }): { width: number; height: number } {
	const scale = Math.min(1, area.width / width, area.height / height);
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 埋め込む画像の大きさ（A-20）: `|300` は幅、`|300x200` は幅と高さ。指定がなければ元の大きさ。どちらも本文の領域に収める。 */
export function imageSize(node: Pick<EmbedImage, "width" | "height">, natural: { width: number; height: number }, area: { width: number; height: number }): { width: number; height: number } {
	let width = natural.width;
	let height = natural.height;
	if (node.width !== undefined) {
		width = node.width;
		height = node.height ?? (natural.width > 0 ? (node.width * natural.height) / natural.width : node.width);
	}
	return fitImage(width, height, area);
}

interface Format {
	bold?: boolean;
	italics?: boolean;
	strike?: boolean;
	highlight?: boolean;
	code?: boolean;
	link?: boolean;
	underline?: boolean;
	superScript?: boolean;
	subScript?: boolean;
	color?: string;
}

/** 番号付きリストの定義（numbering.xml）を集める。開始番号ごとに定義を作り、リストごとに instance を変えて番号を振り直す（A-3）。 */
class NumberingRegistry {
	private readonly starts = new Set<number>();
	private nextInstance = 1;

	ordered(start: number): { reference: string; instance: number } {
		this.starts.add(start);
		return { reference: `ordered-${start}`, instance: this.nextInstance++ };
	}

	bullet(): { reference: string; instance: number } {
		return { reference: "bullet", instance: this.nextInstance++ };
	}

	config(): { reference: string; levels: ILevelsOptions[] }[] {
		const indent = (level: number) => ({ indent: { left: LIST_INDENT_TWIP * (level + 2), hanging: LIST_INDENT_TWIP } });
		const configs: { reference: string; levels: ILevelsOptions[] }[] = [
			// 見出しの段落番号（C-1c）: 1 / 1.1 / 1.1.1 …。字下げせず、番号の後ろは空白
			{
				reference: HEADING_NUMBERING,
				levels: Array.from({ length: 6 }, (_, level) => ({
					level,
					format: LevelFormat.DECIMAL,
					text: Array.from({ length: level + 1 }, (_, k) => `%${k + 1}`).join("."),
					alignment: AlignmentType.LEFT,
					suffix: LevelSuffix.SPACE,
					style: { paragraph: { indent: { left: 0, hanging: 0 } } },
				})),
			},
			{
				reference: "bullet",
				levels: Array.from({ length: 9 }, (_, level) => ({
					level,
					format: LevelFormat.BULLET,
					text: BULLETS[level % BULLETS.length],
					alignment: AlignmentType.LEFT,
					style: { paragraph: indent(level) },
				})),
			},
		];
		for (const start of this.starts) {
			configs.push({
				reference: `ordered-${start}`,
				levels: Array.from({ length: 9 }, (_, level) => ({
					level,
					format: LevelFormat.DECIMAL,
					text: `%${level + 1}.`,
					start: level === 0 ? start : 1,
					alignment: AlignmentType.LEFT,
					style: { paragraph: indent(level) },
				})),
			});
		}
		return configs;
	}
}

type Block = Paragraph | Table;

const HEADING_NUMBERING = "heading-numbering";

class Renderer {
	readonly numbering = new NumberingRegistry();
	/** Word の脚注（番号 → 中身）。参照された順に番号を振る（A-10） */
	readonly footnotes: Record<string, { children: Paragraph[] }> = {};
	private readonly footnoteDefs = new Map<string, FootnoteDefinition>();
	private readonly footnoteIds = new Map<string, number>();
	private nextFootnote = 1;
	private readonly area: { width: number; height: number };
	/** 直前の見出しの文字（図表番号のキャプション: R4・C-4b） */
	private lastHeading: string | undefined;
	/** まだブロックを 1 つも出していないか・直前のブロックが改ページか（見出し 1 の前の改ページ: C-2） */
	private atStart = true;
	private afterPageBreak = false;

	constructor(
		private readonly options: DocxRenderOptions,
		tree: Root,
	) {
		this.area = bodyArea(options.page);
		walk(tree, (node) => {
			if (node.type === "footnoteDefinition" && !this.footnoteDefs.has(node.identifier)) this.footnoteDefs.set(node.identifier, node);
		});
	}

	blocks(nodes: readonly RootContent[], headingShift: number): Block[] {
		const out: Block[] = [];
		for (const node of nodes) {
			const blocks = this.block(node, headingShift);
			if (blocks.length > 0) {
				this.atStart = false;
				this.afterPageBreak = node.type === "pageBreak";
			}
			for (const block of blocks) {
				// 表が続くと Word が 1 つの表にまとめるので、間に空の段落を入れる
				if (block instanceof Table && out[out.length - 1] instanceof Table) out.push(new Paragraph({ children: [] }));
				out.push(block);
			}
		}
		return out;
	}

	private block(node: RootContent, headingShift: number): Block[] {
		if (node.data?.unsupported) return [this.original(node)];
		switch (node.type) {
			case "yaml":
			case "footnoteDefinition":
				return [];
			case "heading":
				return [this.heading(node, headingShift)];
			case "paragraph": {
				const paragraph = new Paragraph({ children: this.bookmarked(node, this.inlines(node.children, {})) });
				const image = soleImage(node.children);
				const caption = image && this.options.captions?.figure !== undefined && image.data?.image ? this.caption("figure", imageCaption(image) ?? this.lastHeading) : undefined;
				return caption ? [paragraph, caption] : [paragraph];
			}
			case "list":
				return this.withBookmark(node, this.list(node, 0));
			case "table": {
				const caption = this.options.captions?.table !== undefined ? this.caption("table", this.lastHeading) : undefined;
				return this.withBookmark(node, caption ? [caption, this.table(node)] : [this.table(node)]);
			}
			case "code":
				return this.code(node);
			case "blockquote":
				return this.withBookmark(
					node,
					node.children.flatMap((child) => this.quoteBlock(child as BlockContent, headingShift)),
				);
			case "callout":
				return this.withBookmark(node, [this.callout(node, headingShift)]);
			case "thematicBreak":
				return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } }, children: [] })];
			case "pageBreak":
				return [new Paragraph({ children: [new DocxPageBreak()] })];
			case "math":
				// ブロックの数式は中央に置いた数式だけの段落（Word が独立した数式として扱う）
				return [new Paragraph({ alignment: AlignmentType.CENTER, children: this.math(node.value, node.data?.image, true) })];
			default:
				return [this.original(node)];
		}
	}

	/** ブックマークを付ける（A-19）。リンクされているノードだけが data.bookmark を持つ。 */
	private bookmarked(node: RootContent, runs: ParagraphChild[]): ParagraphChild[] {
		const id = node.data?.bookmark;
		return id ? [new Bookmark({ id, children: runs })] : runs;
	}

	/** 段落でないブロックのブックマークは、直前の小さな段落に置く。 */
	private withBookmark(node: RootContent, blocks: Block[]): Block[] {
		const id = node.data?.bookmark;
		if (!id) return blocks;
		return [new Paragraph({ spacing: { before: 0, after: 0 }, children: [new Bookmark({ id, children: [] })] }), ...blocks];
	}

	private heading(node: Heading, shift: number): Paragraph {
		const level = Math.min(6, node.depth + shift);
		this.lastHeading = phrasingText(node.children).trim() || undefined;
		// 見出し 1 の前で改ページ（C-2）。文書の最初と、直前に改ページがあるとき（結合出力の章の境目など）は付けない
		const pageBreakBefore = this.options.pageBreakBeforeH1 === true && level === 1 && !this.atStart && !this.afterPageBreak;
		return new Paragraph({
			heading: HEADINGS[level - 1],
			...(pageBreakBefore ? { pageBreakBefore: true } : {}),
			...(this.options.headingNumbering ? { numbering: { reference: HEADING_NUMBERING, level: level - 1, instance: 0 } } : {}),
			children: this.bookmarked(node, this.inlines(node.children, {})),
		});
	}

	/** 図表番号（R4・C-4b）:「図 n: キャプション」。番号は Word の SEQ フィールド（ラベルの文字を識別子にして、図表目次で使えるようにする）。 */
	private caption(kind: "figure" | "table", text: string | undefined): Paragraph {
		const label = (kind === "figure" ? this.options.captions?.figure : this.options.captions?.table) ?? "";
		return new Paragraph({
			style: "Caption",
			alignment: kind === "figure" ? AlignmentType.CENTER : AlignmentType.LEFT,
			...(kind === "table" ? { keepNext: true } : {}),
			children: [new TextRun(`${label} `), new SequentialIdentifier(label), new TextRun(text ? `: ${text}` : "")],
		});
	}

	/** 引用の中の段落は「引用文」スタイル（A-5）。入れ子の見出しやリストはそのまま描く。 */
	private quoteBlock(node: BlockContent, headingShift: number): Block[] {
		if (node.type === "paragraph") return [new Paragraph({ style: "Quote", children: this.bookmarked(node, this.inlines(node.children, {})) })];
		if (node.type === "blockquote") return node.children.flatMap((c) => this.quoteBlock(c as BlockContent, headingShift));
		return this.block(node, headingShift);
	}

	/** コールアウト（A-6）: 1 行 1 列の表。左の罫線を種類の色、背景を淡い色にし、先頭に種類名とタイトルを置く。 */
	private callout(node: Callout, headingShift: number): Table {
		const color = node.data?.calloutColor ?? calloutColor(node.calloutType);
		const title = new Paragraph({ spacing: { after: 60 }, children: this.inlines(node.title, { bold: true, color }) });
		const body = this.blocks(node.children, headingShift);
		// セルの最後は段落でなければならない
		if (body.length === 0 || body[body.length - 1] instanceof Table) body.push(new Paragraph({ children: [] }));
		return new Table({
			width: { size: "100%", type: WidthType.PERCENTAGE },
			rows: [
				new TableRow({
					children: [
						new TableCell({
							borders: { left: { style: BorderStyle.SINGLE, size: 24, color }, top: NO_BORDER, bottom: NO_BORDER, right: NO_BORDER },
							shading: { type: ShadingType.CLEAR, color: "auto", fill: lightColor(color) },
							margins: { top: 80, bottom: 80, left: 160, right: 160 },
							children: [title, ...body],
						}),
					],
				}),
			],
		});
	}

	private list(node: List, level: number): Block[] {
		const lvl = Math.min(level, 8);
		const isTaskList = node.children.some((item) => (item.checked !== null && item.checked !== undefined) || item.data?.taskSymbol);
		const numbering = isTaskList ? null : node.ordered ? this.numbering.ordered(node.start ?? 1) : this.numbering.bullet();
		return node.children.flatMap((item) => this.listItem(item, lvl, numbering));
	}

	private listItem(item: ListItem, level: number, numbering: { reference: string; instance: number } | null): Block[] {
		const out: Block[] = [];
		const symbol = item.checked === true ? "☑" : item.checked === false ? "☐" : item.data?.taskSymbol;
		const indent = { left: LIST_INDENT_TWIP * (level + 2), hanging: numbering ? LIST_INDENT_TWIP : 0 };
		let first = true;
		for (const child of item.children) {
			if (child.type === "list") {
				out.push(...this.list(child, level + 1));
			} else if (child.type === "paragraph") {
				let runs = this.inlines(child.children, {});
				if (first && symbol) runs.unshift(new TextRun(`${symbol} `));
				runs = this.bookmarked(child, first ? this.bookmarked(item, runs) : runs);
				const options: IParagraphOptions =
					first && numbering
						? { numbering: { reference: numbering.reference, level, instance: numbering.instance }, children: runs }
						: { indent: { left: indent.left }, children: runs };
				out.push(new Paragraph(options));
			} else {
				out.push(...this.block(child, 0));
			}
			first = false;
		}
		if (item.children.length === 0 && numbering) {
			out.push(new Paragraph({ numbering: { reference: numbering.reference, level, instance: numbering.instance }, children: [] }));
		}
		return out;
	}

	/** 表（A-9・C-6 の基本形）: 見出し行の繰り返し、列の配置、格子の罫線、見出し行の網掛けと太字、幅は自動調整。 */
	private table(node: MdTable): Table {
		const columns = Math.max(1, ...node.children.map((row) => row.children.length));
		const align = (i: number) => {
			switch (node.align?.[i]) {
				case "center":
					return AlignmentType.CENTER;
				case "right":
					return AlignmentType.RIGHT;
				default:
					return AlignmentType.LEFT;
			}
		};
		const rows = node.children.map(
			(row, r) =>
				new TableRow({
					tableHeader: r === 0,
					children: Array.from({ length: columns }, (_, c) => {
						const cell = row.children[c];
						return this.gridCell([new Paragraph({ alignment: align(c), children: cell ? this.inlines(cell.children, r === 0 ? { bold: true } : {}) : [] })], r === 0);
					}),
				}),
		);
		return this.gridTable(rows, columns);
	}

	private gridCell(children: Paragraph[], header: boolean): TableCell {
		const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
		return new TableCell({
			borders: { top: border, bottom: border, left: border, right: border },
			...(header ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "D9D9D9" } } : {}),
			children,
		});
	}

	private gridTable(rows: TableRow[], columns: number): Table {
		const twipWidth = Math.floor(((this.area.width / 96) * 1440) / columns);
		// 本文の幅いっぱい（C-6 のオプション）か、内容に合わせる（既定）
		const width = this.options.tableFullWidth ? { size: "100%" as const, type: WidthType.PERCENTAGE } : { size: 0, type: WidthType.AUTO };
		return new Table({ rows, layout: TableLayoutType.AUTOFIT, columnWidths: Array(columns).fill(twipWidth), width });
	}

	/** 冒頭のプロパティの表（A-27 のオプション）。 */
	propertiesTable(entries: readonly [string, string][]): Table {
		const rows = entries.map(
			([key, value]) =>
				new TableRow({
					children: [this.gridCell([new Paragraph({ children: [new TextRun({ text: key, bold: true })] })], true), this.gridCell([new Paragraph({ children: [new TextRun(value)] })], false)],
				}),
		);
		return this.gridTable(rows, 2);
	}

	/** コードブロック（A-7）: 色付けのトークンがあれば色を付ける。Mermaid は画像にする（A-12・R4）。 */
	private code(node: Code): Paragraph[] {
		const index = node.data?.mermaidIndex;
		if (index !== undefined) {
			const asset = this.options.diagrams.get(index);
			if (asset) {
				const figure = this.diagram(asset, index);
				// 図番号（R4）: キャプションは図の frontmatter の title、なければ直前の見出し
				return this.options.captions?.figure !== undefined ? [figure, this.caption("figure", mermaidTitle(node.value) ?? this.lastHeading)] : [figure];
			}
		}
		const tokens: CodeToken[] = node.data?.tokens ?? [{ text: node.value, types: [] }];
		// 行ごとに、色と斜体の付いた断片に分ける
		type Piece = { text: string; color?: string; italics?: boolean };
		const lines: Piece[][] = [[]];
		for (const token of tokens) {
			const color = tokenColor(token.types);
			const italics = token.types.includes("comment");
			token.text.split("\n").forEach((part, i) => {
				if (i > 0) lines.push([]);
				if (part !== "") lines[lines.length - 1].push({ text: part, ...(color ? { color } : {}), ...(italics ? { italics } : {}) });
			});
		}
		const width = String(lines.length).length;
		const children: ParagraphChild[] = [];
		lines.forEach((pieces, i) => {
			if (this.options.codeLineNumbers) pieces.unshift({ text: `${String(i + 1).padStart(width)}  `, color: "A0A0A0" });
			if (pieces.length === 0) pieces.push({ text: "" });
			// 行の最初の断片に改行を付ける（色なしなら 1 行 = 1 つの w:r でフェーズ 2 と同じ形）
			pieces.forEach((piece, k) => children.push(new TextRun({ ...piece, break: i > 0 && k === 0 ? 1 : 0 })));
		});
		return [new Paragraph({ style: "SourceCode", children: this.bookmarked(node, children) })];
	}

	private diagram(asset: DiagramAsset, index: number): Paragraph {
		const size = fitImage(asset.width, asset.height, this.area);
		return new Paragraph({
			alignment: AlignmentType.CENTER,
			children: [
				new ImageRun({
					type: "svg",
					data: asset.svg,
					transformation: size,
					fallback: { type: "png", data: asset.png },
					altText: { name: `Mermaid ${index}`, description: `Mermaid diagram ${index}`, title: `Mermaid ${index}` },
				}),
			],
		});
	}

	/** 数式（A-11）: Word の数式（OMML）。変換できなかった式は画像、画像もなければ LaTeX の原文を等幅で残す。 */
	private math(latex: string, image: ImageAsset | undefined, display: boolean): ParagraphChild[] {
		if (image) return [this.image({ type: "embedImage", path: "", alt: latex, data: { image } })];
		try {
			return [new DocxMath({ children: latexToMath(latex) })];
		} catch {
			return [this.run(display ? `$$${latex}$$` : `$${latex}$`, { code: true })];
		}
	}

	/** 埋め込む画像（A-20）。読み込めなかった画像は元の記法を等幅で残す。外部の画像はリンクにする。 */
	private image(node: EmbedImage): ParagraphChild {
		const asset = node.data?.image;
		if (!asset && node.url) return new ExternalHyperlink({ link: node.url, children: [this.run(node.alt || node.url, { link: true })] });
		if (!asset || (asset.type === "svg" && !asset.fallback)) return this.run(`![[${node.path}]]`, { code: true });
		const transformation = imageSize(node, asset, this.area);
		const altText = { name: node.alt, description: node.alt, title: node.alt };
		if (asset.type === "svg") return new ImageRun({ type: "svg", data: asset.data, transformation, fallback: { type: "png", data: asset.fallback! }, altText });
		return new ImageRun({ type: asset.type, data: asset.data, transformation, altText });
	}

	/** 未対応の記法を、元の Markdown のまま等幅の段落で残す（A-0b）。 */
	private original(node: RootContent): Paragraph {
		return this.monospaceParagraph(this.sourceOf(node));
	}

	private sourceOf(node: RootContent): string {
		if (node.data?.original !== undefined) return node.data.original;
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		return start !== undefined && end !== undefined ? this.options.source.slice(start, end) : "";
	}

	private monospaceParagraph(text: string): Paragraph {
		const lines = text.split("\n");
		return new Paragraph({
			style: "SourceCode",
			children: lines.map((line, i) => new TextRun({ text: line, break: i === 0 ? 0 : 1 })),
		});
	}

	inlines(nodes: readonly PhrasingContent[], format: Format): ParagraphChild[] {
		return nodes.flatMap((node) => this.inline(node, format));
	}

	private inline(node: PhrasingContent, format: Format): ParagraphChild[] {
		if (node.data?.unsupported) return [this.run(this.sourceOf(node), { ...format, code: true })];
		switch (node.type) {
			case "text":
				return this.text(node.value, format);
			case "strong":
				return this.inlines(node.children, { ...format, bold: true });
			case "emphasis":
				return this.inlines(node.children, { ...format, italics: true });
			case "delete":
				return this.inlines(node.children, { ...format, strike: true });
			case "highlight":
				return this.inlines(node.children, { ...format, highlight: true });
			case "htmlFormat":
				switch (node.tag) {
					case "u":
						return this.inlines(node.children, { ...format, underline: true });
					case "sup":
						return this.inlines(node.children, { ...format, superScript: true });
					case "sub":
						return this.inlines(node.children, { ...format, subScript: true });
					default:
						return this.inlines(node.children, { ...format, highlight: true });
				}
			case "inlineCode":
				return [this.run(node.value, { ...format, code: true })];
			case "break":
				return [new TextRun({ break: 1 })];
			case "link":
				// リンクの解決（note-assembly.ts）の後に残る link は、どれもハイパーリンクにする
				return [new ExternalHyperlink({ link: node.url, children: this.inlines(node.children, { ...format, link: true }) })];
			case "internalLink":
				return [new InternalHyperlink({ anchor: node.anchor, children: this.inlines(node.children, { ...format, link: true }) })];
			case "wikiLink":
				// 解決されずに残ったリンクは表示文字だけ
				return this.inlines(node.children, format);
			case "embedImage":
				return [this.image(node)];
			case "inlineMath":
				return this.math(node.value, node.data?.image, false);
			case "footnoteReference": {
				const def = this.footnoteDefs.get(node.identifier);
				if (!def) return [this.run(`[^${node.label ?? node.identifier}]`, format)];
				const seen = this.footnoteIds.get(node.identifier);
				// Word は 1 つの脚注を 2 か所から参照（w:footnoteReference の重複）すると「ファイルが壊れている」として開かない。
				// 2 回目以降は脚注参照のスタイルで番号の文字だけを置く。番号は本文での出現順に振るので、Word が表示する番号と一致する
				if (seen !== undefined) return [new TextRun({ text: String(seen), style: "FootnoteReference", superScript: true })];
				const id = this.addFootnote(def.children);
				this.footnoteIds.set(node.identifier, id);
				return [new FootnoteReferenceRun(id)];
			}
			case "inlineFootnote":
				return [new FootnoteReferenceRun(this.addFootnote([{ type: "paragraph", children: node.children }]))];
			case "commentMark":
				if (this.options.comments?.[node.id] === undefined) return [];
				return [new CommentRangeStart(node.id), new CommentRangeEnd(node.id), new TextRun({ children: [new CommentReference(node.id)] })];
			default:
				return [this.run(this.sourceOf(node), { ...format, code: true })];
		}
	}

	/** 脚注を足して番号を返す。脚注の中は段落だけにできるので、表などは落とす。 */
	private addFootnote(content: RootContent[]): number {
		const id = this.nextFootnote++;
		this.footnotes[String(id)] = { children: [] };
		const paragraphs = this.blocks(content, 0).filter((b): b is Paragraph => b instanceof Paragraph);
		this.footnotes[String(id)] = { children: paragraphs.length > 0 ? paragraphs : [new Paragraph({ children: [] })] };
		return id;
	}

	/** 段落内の改行: 厳密な改行がオフなら w:br、オンなら空白（A-2）。 */
	private text(value: string, format: Format): ParagraphChild[] {
		const lines = value.split("\n");
		if (lines.length === 1) return [this.run(value, format)];
		if (this.options.strictLineBreaks) return [this.run(lines.join(" "), format)];
		return lines.map((line, i) => this.run(line, format, i > 0));
	}

	private run(text: string, format: Format, breakBefore = false): TextRun {
		return new TextRun({
			text,
			...(breakBefore ? { break: 1 } : {}),
			...(format.bold ? { bold: true } : {}),
			...(format.italics ? { italics: true } : {}),
			...(format.strike ? { strike: true } : {}),
			...(format.highlight ? { highlight: "yellow" } : {}),
			...(format.code ? { font: MONO_FONT, shading: CODE_SHADING } : {}),
			...(format.link ? { style: "Hyperlink" } : {}),
			...(format.underline ? { underline: {} } : {}),
			...(format.superScript ? { superScript: true } : {}),
			...(format.subScript ? { subScript: true } : {}),
			...(format.color ? { color: format.color } : {}),
		});
	}
}

/** mdast（変換済み）から .docx を作る。 */
export async function renderDocx(tree: Root, options: DocxRenderOptions): Promise<ArrayBuffer> {
	const renderer = new Renderer(options, tree);
	const shift = options.fileNameAsTitle ? 1 : 0;
	const children: (Block | TableOfContents)[] = [];
	// 表紙（C-8）: タイトル・作成者・日付を 1 ページ目に置き、改ページする
	if (options.cover) {
		const { cover } = options;
		children.push(
			new Paragraph({ spacing: { before: 4800 }, alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE, children: [new TextRun({ text: cover.title, size: 56 })] }),
			...(cover.author ? [new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: cover.author, size: 28 })] })] : []),
			new Paragraph({ spacing: { before: cover.author ? 240 : 1200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: cover.date, size: 24 })] }),
			new Paragraph({ children: [new DocxPageBreak()] }),
		);
	}
	// 目次（C-4a）: 見出し 1〜3 の TOC フィールド。開いたときに Word が更新する（updateFields）
	if (options.tableOfContents !== undefined) {
		children.push(
			new Paragraph({ children: [new TextRun({ text: options.tableOfContents, bold: true, size: 32 })] }),
			new TableOfContents(options.tableOfContents, { hyperlink: true, headingStyleRange: "1-3" }),
			new Paragraph({ children: [new DocxPageBreak()] }),
		);
	}
	if (options.fileNameAsTitle) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(options.title)] }));
	if (options.propertiesTable && options.propertiesTable.length > 0) children.push(renderer.propertiesTable(options.propertiesTable), new Paragraph({ children: [] }));
	children.push(...timedSync("docx/render/blocks", () => renderer.blocks(tree.children, shift)));

	const { fonts, page } = options;
	const body = { ascii: fonts.bodyLatin, hAnsi: fonts.bodyLatin, cs: fonts.bodyLatin, eastAsia: fonts.bodyEastAsia };
	const head = { ascii: fonts.headingLatin, hAnsi: fonts.headingLatin, cs: fonts.headingLatin, eastAsia: fonts.headingEastAsia };
	// 見出しのスタイル（C-1a）: 大きさ（half-point）・太字・前後の間隔、次の段落と同じページに置く
	const headingStyle = (size: number, before: number) => ({ run: { font: head, size, bold: true }, paragraph: { spacing: { before, after: 120 }, keepNext: true, keepLines: true } });
	const paper = PAPER_MM[page.paperSize];
	const comments = (options.comments ?? []).map((text, id) => ({
		id,
		author: options.creator,
		children: text.split(/\n\s*\n/).map((p) => new Paragraph({ children: [new TextRun(p.replace(/\n/g, " "))] })),
	}));

	const doc = new Document({
		creator: options.creator,
		lastModifiedBy: options.creator,
		title: options.title,
		description: "",
		...(options.properties?.keywords ? { keywords: options.properties.keywords } : {}),
		...(options.properties?.custom && options.properties.custom.length > 0 ? { customProperties: options.properties.custom } : {}),
		...(comments.length > 0 ? { comments: { children: comments } } : {}),
		footnotes: renderer.footnotes,
		styles: documentStyles(options, body, headingStyle),
		...(options.template ? { externalStyles: options.template.styles, ...(options.template.theme ? { theme: options.template.theme } : {}) } : {}),
		numbering: { config: renderer.numbering.config() },
		...(options.tableOfContents !== undefined ? { features: { updateFields: true } } : {}),
		sections: [
			{
				...headersAndFooters(options),
				properties: {
					...(options.cover ? { titlePage: true } : {}),
					page: {
						size: {
							width: convertMillimetersToTwip(paper.width),
							height: convertMillimetersToTwip(paper.height),
							orientation: page.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
						},
						margin: {
							top: convertMillimetersToTwip(page.marginsMm.top),
							bottom: convertMillimetersToTwip(page.marginsMm.bottom),
							left: convertMillimetersToTwip(page.marginsMm.left),
							right: convertMillimetersToTwip(page.marginsMm.right),
						},
					},
				},
				children,
			},
		],
	});
	const created = options.properties?.created;
	const overrides = created ? [{ path: "docProps/core.xml", data: coreXml(options, created) }] : [];
	const packed = await timed("docx/render/pack", () => Packer.pack(doc, "arraybuffer", false, overrides));
	return options.headingNumbering ? timedSync("docx/render/headingFix", () => withoutHeadingStartOverrides(packed)) : packed;
}

/**
 * 見出しの段落番号の定義（w:num）から、開始番号の上書き（w:lvlOverride / w:startOverride）を取り除く（C-1c）。
 * docx ライブラリはすべての番号の定義にこれを付けるが、見出しの番号に付いていると、Word は印刷・PDF のレイアウトで
 * 見出し 1 の番号を数え直してしまう（2 つ目の見出し 1 が「1」になる）。番号付きリストの上書き（リストごとの振り直し）は残す。
 */
export function withoutHeadingStartOverrides(docx: ArrayBuffer): ArrayBuffer {
	const files = unzipSync(new Uint8Array(docx));
	const numbering = files["word/numbering.xml"];
	if (!numbering) return docx;
	const xml = strFromU8(numbering);
	// 見出しの段落番号の定義は、レベル 2 の番号の書式が「%1.%2」のもの（番号付きリストは「%2.」）
	const ids = [...xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)].filter((m) => m[2].includes('<w:lvlText w:val="%1.%2"/>')).map((m) => m[1]);
	if (ids.length === 0) return docx;
	const fixed = xml.replace(/<w:num\b[^>]*>([\s\S]*?)<\/w:num>/g, (num: string, body: string) => {
		const abstractId = /<w:abstractNumId w:val="(\d+)"\/>/.exec(body)?.[1];
		return abstractId !== undefined && ids.includes(abstractId) ? num.replace(/<w:lvlOverride\b[^>]*>[\s\S]*?<\/w:lvlOverride>/g, "") : num;
	});
	files["word/numbering.xml"] = strToU8(fixed);
	const zipped = zipSync(files);
	return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength);
}

/** 内蔵の段落スタイル: 引用文（A-5）・コード（A-7）・図表番号（R4・C-4b）。 */
const BUILTIN_PARAGRAPH_STYLES: readonly IParagraphStyleOptions[] = [
	{
		id: "Quote",
		name: "Quote",
		basedOn: "Normal",
		next: "Normal",
		run: { color: "404040" },
		paragraph: { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "A6A6A6", space: 8 } } },
	},
	{
		id: "SourceCode",
		name: "Source Code",
		basedOn: "Normal",
		next: "Normal",
		run: { font: MONO_FONT, size: 20 },
		paragraph: { shading: CODE_SHADING, spacing: { before: 60, after: 60 } },
	},
	{
		id: "Caption",
		name: "caption",
		basedOn: "Normal",
		next: "Normal",
		run: { size: 18, color: "404040" },
		paragraph: { spacing: { before: 60, after: 200 } },
	},
];

/**
 * 文書のスタイル。テンプレート（C-1b）があればテンプレートのスタイルを使い、テンプレートにない内蔵の段落スタイルだけを補う。
 * なければ内蔵の既定（本文と見出しのフォント・見出しの大きさと太さ: C-1a・C-3）。
 */
function documentStyles(
	options: DocxRenderOptions,
	body: { ascii: string; hAnsi: string; cs: string; eastAsia: string },
	headingStyle: (size: number, before: number) => NonNullable<NonNullable<IStylesOptions["default"]>["heading1"]>,
): IStylesOptions {
	if (options.template) {
		const defined = styleIds(options.template.styles);
		return { paragraphStyles: BUILTIN_PARAGRAPH_STYLES.filter((style) => !defined.has(style.id)) };
	}
	return {
		default: {
			document: { run: { font: body } },
			title: headingStyle(48, 0),
			heading1: headingStyle(32, 360),
			heading2: headingStyle(28, 300),
			heading3: headingStyle(24, 240),
			heading4: headingStyle(22, 200),
			heading5: headingStyle(22, 200),
			heading6: headingStyle(22, 200),
		},
		paragraphStyles: BUILTIN_PARAGRAPH_STYLES,
	};
}

/** ヘッダーのタイトルとフッターのページ番号（C-5）。表紙があるときは、先頭ページ（表紙）だけ空にする。 */
function headersAndFooters(options: DocxRenderOptions): { headers?: { default: Header; first?: Header }; footers?: { default: Footer; first?: Footer } } {
	const out: { headers?: { default: Header; first?: Header }; footers?: { default: Footer; first?: Footer } } = {};
	if (options.headerTitle) {
		const header = new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: options.title, size: 18, color: "595959" })] })] });
		out.headers = { default: header, ...(options.cover ? { first: new Header({ children: [] }) } : {}) };
	}
	if (options.footerPageNumber) {
		const footer = new Footer({
			children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], size: 18 })] })],
		});
		out.footers = { default: footer, ...(options.cover ? { first: new Footer({ children: [] }) } : {}) };
	}
	return out;
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 作成日時を入れた docProps/core.xml（docx ライブラリは作成日時を指定できないため、ファイルを差し替える: A-27）。 */
export function coreXml(options: Pick<DocxRenderOptions, "title" | "creator" | "properties">, created: Date): string {
	const w3cdtf = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
	const keywords = options.properties?.keywords;
	return [
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
		`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
		`<dc:title>${escapeXml(options.title)}</dc:title>`,
		`<dc:creator>${escapeXml(options.creator)}</dc:creator>`,
		keywords ? `<cp:keywords>${escapeXml(keywords)}</cp:keywords>` : "",
		`<dc:description></dc:description>`,
		`<cp:lastModifiedBy>${escapeXml(options.creator)}</cp:lastModifiedBy>`,
		`<cp:revision>1</cp:revision>`,
		`<dcterms:created xsi:type="dcterms:W3CDTF">${w3cdtf(created)}</dcterms:created>`,
		`<dcterms:modified xsi:type="dcterms:W3CDTF">${w3cdtf(new Date())}</dcterms:modified>`,
		`</cp:coreProperties>`,
	].join("");
}

/** インラインノードの表示テキスト（見出しの文字: 図表番号のキャプション）。 */
function phrasingText(nodes: readonly PhrasingContent[]): string {
	let out = "";
	for (const node of nodes) {
		if ("value" in node && typeof node.value === "string" && node.type !== "html") out += node.value;
		else if ("children" in node && Array.isArray(node.children)) out += phrasingText(node.children);
	}
	return out;
}

/** 段落が画像 1 つだけ（前後の空白を除く）なら、その画像（図番号を付ける対象: C-4b）。 */
function soleImage(nodes: readonly PhrasingContent[]): EmbedImage | undefined {
	const rest = nodes.filter((n) => !(n.type === "text" && n.value.trim() === ""));
	return rest.length === 1 && rest[0].type === "embedImage" ? rest[0] : undefined;
}

/** 画像のキャプション: 代替テキスト。ファイル名と同じ（`![[a.png]]` の代替テキスト）なら使わない（C-4b）。 */
function imageCaption(image: EmbedImage): string | undefined {
	const alt = image.alt.trim();
	if (alt === "") return undefined;
	const name = image.path.slice(image.path.lastIndexOf("/") + 1);
	return alt === name || alt === name.replace(/\.[^.]+$/, "") ? undefined : alt;
}

/** Mermaid の図の frontmatter の title（R4）。 */
export function mermaidTitle(source: string): string | undefined {
	const m = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(source);
	const title = m ? /^title:\s*(.+?)\s*$/m.exec(m[1])?.[1] : undefined;
	return title?.replace(/^["']|["']$/g, "") || undefined;
}
