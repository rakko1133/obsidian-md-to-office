// .docx のレンダラ（07: .docx の生成・G2・G3・R5・R6）。mdast → docx ライブラリのオブジェクト → バイト列。
// Obsidian API に依存しない。フェーズ 2 の範囲: 見出し・段落・改行・リスト・タスク・表・文字書式・Mermaid・引用・コード・水平線・外部リンク。
// それ以外の記法は元の Markdown を等幅の段落で残す（A-0b）。
import {
	AlignmentType,
	BorderStyle,
	Document,
	ExternalHyperlink,
	HeadingLevel,
	ImageRun,
	LevelFormat,
	Packer,
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
	type IParagraphOptions,
	type ParagraphChild,
} from "docx";
import type { BlockContent, Code, Heading, List, ListItem, PhrasingContent, Root, RootContent, Table as MdTable } from "mdast";

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

export interface DocxRenderOptions {
	/** 文書プロパティのタイトル（ノート名） */
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

interface Format {
	bold?: boolean;
	italics?: boolean;
	strike?: boolean;
	highlight?: boolean;
	code?: boolean;
	link?: boolean;
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
			{
				reference: "bullet",
				levels: Array.from({ length: 9 }, (_, level) => ({
					level,
					format: LevelFormat.BULLET,
					text: BULLETS[level % BULLETS.length]!,
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

class Renderer {
	readonly numbering = new NumberingRegistry();
	private readonly area: { width: number; height: number };

	constructor(private readonly options: DocxRenderOptions) {
		this.area = bodyArea(options.page);
	}

	blocks(nodes: readonly RootContent[], headingShift: number): (Paragraph | Table)[] {
		return nodes.flatMap((node) => this.block(node, headingShift));
	}

	private block(node: RootContent, headingShift: number): (Paragraph | Table)[] {
		if (node.data?.unsupported) return [this.original(node)];
		switch (node.type) {
			case "yaml":
				return [];
			case "heading":
				return [this.heading(node, headingShift)];
			case "paragraph":
				return [new Paragraph({ children: this.inlines(node.children, {}) })];
			case "list":
				return this.list(node, 0);
			case "table":
				return [this.table(node)];
			case "code":
				return [this.code(node)];
			case "blockquote":
				return node.children.flatMap((child) => this.quoteBlock(child as BlockContent, headingShift));
			case "thematicBreak":
				return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } }, children: [] })];
			default:
				return [this.original(node)];
		}
	}

	private heading(node: Heading, shift: number): Paragraph {
		const level = Math.min(6, node.depth + shift);
		return new Paragraph({ heading: HEADINGS[level - 1]!, children: this.inlines(node.children, {}) });
	}

	/** 引用の中の段落は「引用文」スタイル（A-5）。入れ子の見出しやリストはそのまま描く。 */
	private quoteBlock(node: BlockContent, headingShift: number): (Paragraph | Table)[] {
		if (node.type === "paragraph") return [new Paragraph({ style: "Quote", children: this.inlines(node.children, {}) })];
		if (node.type === "blockquote") return node.children.flatMap((c) => this.quoteBlock(c as BlockContent, headingShift));
		return this.block(node, headingShift);
	}

	private list(node: List, level: number): (Paragraph | Table)[] {
		const lvl = Math.min(level, 8);
		const isTaskList = node.children.some((item) => (item.checked !== null && item.checked !== undefined) || item.data?.taskSymbol);
		const numbering = isTaskList ? null : node.ordered ? this.numbering.ordered(node.start ?? 1) : this.numbering.bullet();
		return node.children.flatMap((item) => this.listItem(item, lvl, numbering));
	}

	private listItem(item: ListItem, level: number, numbering: { reference: string; instance: number } | null): (Paragraph | Table)[] {
		const out: (Paragraph | Table)[] = [];
		const symbol = item.checked === true ? "☑" : item.checked === false ? "☐" : item.data?.taskSymbol;
		const indent = { left: LIST_INDENT_TWIP * (level + 2), hanging: numbering ? LIST_INDENT_TWIP : 0 };
		let first = true;
		for (const child of item.children) {
			if (child.type === "list") {
				out.push(...this.list(child, level + 1));
			} else if (child.type === "paragraph") {
				const runs = this.inlines(child.children, {});
				if (first && symbol) runs.unshift(new TextRun(`${symbol} `));
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
		const twipWidth = Math.floor(((this.area.width / 96) * 1440) / columns);
		const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
		const rows = node.children.map(
			(row, r) =>
				new TableRow({
					tableHeader: r === 0,
					children: Array.from({ length: columns }, (_, c) => {
						const cell = row.children[c];
						return new TableCell({
							borders: { top: border, bottom: border, left: border, right: border },
							...(r === 0 ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "D9D9D9" } } : {}),
							children: [new Paragraph({ alignment: align(c), children: cell ? this.inlines(cell.children, r === 0 ? { bold: true } : {}) : [] })],
						});
					}),
				}),
		);
		return new Table({ rows, layout: TableLayoutType.AUTOFIT, columnWidths: Array(columns).fill(twipWidth), width: { size: 0, type: WidthType.AUTO } });
	}

	/** コードブロック（A-7: 色付けなしの等幅 + 網掛け）。Mermaid は画像にする（A-12・R4）。 */
	private code(node: Code): Paragraph {
		const index = node.data?.mermaidIndex;
		if (index !== undefined) {
			const asset = this.options.diagrams.get(index);
			if (asset) return this.diagram(asset, index);
		}
		return this.monospaceParagraph(node.value);
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

	/** 未対応の記法を、元の Markdown のまま等幅の段落で残す（A-0b）。 */
	private original(node: RootContent): Paragraph {
		return this.monospaceParagraph(this.sourceOf(node));
	}

	private sourceOf(node: RootContent): string {
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
			case "inlineCode":
				return [this.run(node.value, { ...format, code: true })];
			case "break":
				return [new TextRun({ break: 1 })];
			case "link":
				if (/^(https?:|mailto:)/i.test(node.url)) {
					return [new ExternalHyperlink({ link: node.url, children: this.inlines(node.children, { ...format, link: true }) as TextRun[] })];
				}
				// 内部リンクはフェーズ 3 まで文字だけ残す
				return this.inlines(node.children, format);
			default:
				return [this.run(this.sourceOf(node as RootContent), { ...format, code: true })];
		}
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
		});
	}
}

/** mdast（変換済み）から .docx を作る。 */
export async function renderDocx(tree: Root, options: DocxRenderOptions): Promise<ArrayBuffer> {
	const renderer = new Renderer(options);
	const shift = options.fileNameAsTitle ? 1 : 0;
	const children: (Paragraph | Table)[] = [];
	if (options.fileNameAsTitle) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(options.title)] }));
	children.push(...renderer.blocks(tree.children, shift));

	const { fonts, page } = options;
	const body = { ascii: fonts.bodyLatin, hAnsi: fonts.bodyLatin, cs: fonts.bodyLatin, eastAsia: fonts.bodyEastAsia };
	const head = { ascii: fonts.headingLatin, hAnsi: fonts.headingLatin, cs: fonts.headingLatin, eastAsia: fonts.headingEastAsia };
	const headingStyle = { run: { font: head } };
	const paper = PAPER_MM[page.paperSize];

	const doc = new Document({
		creator: options.creator,
		lastModifiedBy: options.creator,
		title: options.title,
		description: "",
		styles: {
			default: {
				document: { run: { font: body } },
				title: headingStyle,
				heading1: headingStyle,
				heading2: headingStyle,
				heading3: headingStyle,
				heading4: headingStyle,
				heading5: headingStyle,
				heading6: headingStyle,
			},
			paragraphStyles: [
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
			],
		},
		numbering: { config: renderer.numbering.config() },
		sections: [
			{
				properties: {
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
	return Packer.toArrayBuffer(doc);
}
