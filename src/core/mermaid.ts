// Mermaid の図の取り出し・描画用ソースの組み立て・ハッシュと命名（06: Mermaid の画像化・R1・R4）。
// Obsidian API に依存しない。実際の描画は src/obsidian/mermaid-renderer.ts が行う。
import { sha256Hex } from "./hash";
import { parseMarkdown, visitMermaidCodes } from "./markdown";

/** ノートの中の Mermaid の図 1 つ。index は 1 から始まるノート内の連番。 */
export interface MermaidBlock {
	index: number;
	source: string;
}

/** 描画結果を変える設定値（R4: ハッシュの入力に含める）。 */
export interface MermaidRenderParams {
	theme: "neutral";
	fontFamily: string;
	dpi: number;
	transparentBackground: boolean;
}

/** Markdown から Mermaid のコードブロックを、出てくる順に取り出す（G2: mdast を使う）。連番は markMermaid と同じ順序。 */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
	const blocks: MermaidBlock[] = [];
	visitMermaidCodes(parseMarkdown(markdown), (node) => blocks.push({ index: blocks.length + 1, source: node.value }));
	return blocks;
}

/**
 * 描画に渡すソースを作る。プラグインの設定を `%%{init: ...}%%` ディレクティブとして足す（R1: グローバル設定には触れない）。
 * 利用者が書いたディレクティブは残し、その後ろにプラグインのディレクティブを置いて、テーマ・フォント・htmlLabels だけを上書きする。
 * 先頭の frontmatter（`---` で囲んだ設定）は先頭のまま残す。
 */
export function buildRenderSource(source: string, params: Pick<MermaidRenderParams, "theme" | "fontFamily">): string {
	const init = {
		theme: params.theme,
		fontFamily: params.fontFamily,
		htmlLabels: false,
		flowchart: { htmlLabels: false },
		themeVariables: { fontFamily: params.fontFamily },
	};
	const directive = `%%{init: ${JSON.stringify(init)}}%%`;
	const lines = source.replace(/\r\n/g, "\n").split("\n");
	let i = 0;
	// 先頭の frontmatter
	if (lines[0]?.trim() === "---") {
		const end = lines.findIndex((line, n) => n > 0 && line.trim() === "---");
		if (end > 0) i = end + 1;
	}
	// 利用者のディレクティブと空行
	while (i < lines.length && (lines[i]!.trim() === "" || /^%%\{.*\}%%$/.test(lines[i]!.trim()))) i++;
	return [...lines.slice(0, i), directive, ...lines.slice(i)].join("\n");
}

/** 図のハッシュ（SHA-256 の 16 進）。ソース・描画結果を変える設定値・mermaid.js のバージョンから計算する（R4）。 */
export async function diagramHash(source: string, params: MermaidRenderParams, mermaidVersion: string): Promise<string> {
	return sha256Hex(JSON.stringify({ source, params, mermaidVersion }));
}

/** 画像のファイル名 `{ノート名}_mermaid_{連番2桁}_{ハッシュ8桁}.{拡張子}`（R4）。 */
export function imageFileName(noteBaseName: string, index: number, hash: string, ext: "svg" | "png"): string {
	return `${noteBaseName}_mermaid_${String(index).padStart(2, "0")}_${hash.slice(0, 8)}.${ext}`;
}

/** 設定値から、保存する画像の拡張子の一覧を返す（R1）。 */
export function imageExtensions(format: "svg" | "png" | "both"): ("svg" | "png")[] {
	return format === "both" ? ["svg", "png"] : [format];
}
