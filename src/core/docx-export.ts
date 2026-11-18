// ノート 1 件を .docx にする（04 → 06 → 07 → 09 の流れ・フェーズ 2）と、そのドライラン（02）。
// Obsidian API に依存しない。描画・キャッシュ・書き込みは引数の部品に任せる。
import type { Root } from "mdast";
import { renderDocx, type DiagramAsset } from "./docx-render";
import { mapFrontmatter } from "./frontmatter";
import { visitMermaidCodes } from "./markdown";
import { buildRenderSource, diagramHash, type MermaidBlock, type MermaidRenderParams } from "./mermaid";
import { exportMermaidNote, renderParams, type MermaidExportDeps } from "./mermaid-export";
import { assembleNote, type NoteEnvironment } from "./note-assembly";
import { joinPath, noteBaseName, outputDirFor, plannedAction, relativeUrl } from "./output-plan";
import { setPngDpi } from "./png";
import { aggregateStatus } from "./run";
import type { PluginSettings } from "./settings";
import type { FileResult, ManifestSnapshot, NoteResult, OutputRef, PlannedAction, Warning } from "./types";

/** Vault の読み取り（Obsidian 側が実装する: フェーズ 3a）。 */
export type VaultEnvironment = Omit<NoteEnvironment, "readNote" | "isConverted" | "docxLink"> & {
	/** ノートの frontmatter（metadataCache: A-27） */
	frontmatter?(path: string): Readonly<Record<string, unknown>> | undefined;
};

export interface DocxExportDeps extends MermaidExportDeps {
	/** Obsidian の「厳密な改行」。読めなければ undefined（設定の値を使う: A-2） */
	strictLineBreaks: boolean | undefined;
	/** リンクの解決・画像の読み込み・コードの色付け。なければリンクはすべて文字だけになる */
	vault?: VaultEnvironment;
	/** 今回の実行の対象ノート（内部リンクの「変換対象」の範囲: A-18） */
	convertedNotes?: ReadonlySet<string>;
}

const EMPTY_VAULT: VaultEnvironment = { resolveLink: () => null, fileExists: () => false, vaultName: "" };

/** 変換対象のノート: 今回の対象と、マニフェストに .docx として記録されたノート（A-18）。 */
export function convertedNotes(current: ReadonlySet<string> | undefined, manifest: ManifestSnapshot): Set<string> {
	const out = new Set(current ?? []);
	for (const entry of manifest.entries) if (entry.kind === "docx") for (const source of entry.sources) out.add(source);
	return out;
}

/** 組み立てた木から Mermaid の図を取り出す（埋め込んだノートの図も含む。連番は markMermaid が付けたもの）。 */
export function mermaidBlocksOf(tree: Root): MermaidBlock[] {
	const blocks: MermaidBlock[] = [];
	visitMermaidCodes(tree, (node) => {
		if (node.data?.mermaidIndex !== undefined) blocks.push({ index: node.data.mermaidIndex, source: node.value });
	});
	return blocks;
}

export interface PlannedOutput {
	output: OutputRef;
	action: PlannedAction;
}

/** .docx の出力先（1 ノート = 1 .docx: R8）。 */
export function docxOutputRef(notePath: string, settings: PluginSettings): OutputRef {
	const dir = outputDirFor(notePath, settings);
	return { location: dir.location, path: joinPath(dir.path, `${noteBaseName(notePath)}.docx`) };
}

/** ドライラン: 出力パスと予定動作。連番を付けるときの実際の名前は書き込み時に決める。 */
export async function planDocxNote(notePath: string, settings: PluginSettings, exists: (ref: OutputRef) => Promise<boolean>): Promise<PlannedOutput[]> {
	const output = docxOutputRef(notePath, settings);
	return [{ output, action: plannedAction(await exists(output), false, settings.onConflict) }];
}

/** Mermaid の図 1 つの SVG と PNG を、キャッシュから取るか描画して作る（.docx への埋め込み用: SVG + PNG フォールバック）。 */
export async function diagramAsset(block: MermaidBlock, params: MermaidRenderParams, deps: Pick<MermaidExportDeps, "renderer" | "cache">, signal: AbortSignal): Promise<DiagramAsset> {
	const hash = await diagramHash(block.source, params, deps.renderer.version);
	let svg = await deps.cache.get(hash, "svg").catch(() => null);
	let png = await deps.cache.get(hash, "png").catch(() => null);
	if (!svg || !png) {
		if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
		const rendered = await deps.renderer.render(buildRenderSource(block.source, params), params, true, signal);
		if (!rendered.png) throw new Error(`PNG: ${rendered.pngError ?? "unknown"}`);
		svg = new TextEncoder().encode(rendered.svg);
		png = setPngDpi(rendered.png, params.dpi);
		await deps.cache.put(hash, "svg", svg).catch(() => undefined);
		await deps.cache.put(hash, "png", png).catch(() => undefined);
	}
	const { width, height } = svgSize(new TextDecoder().decode(svg));
	return { svg, png, width, height };
}

/** SVG の width / height 属性（描画の部品が viewBox から書き込んだもの）。 */
export function svgSize(svg: string): { width: number; height: number } {
	const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
	const attr = (name: string) => Number(new RegExp(`\\s${name}="([\\d.]+)"`).exec(tag)?.[1] ?? NaN);
	const width = attr("width");
	const height = attr("height");
	return { width: Number.isFinite(width) && width > 0 ? width : 800, height: Number.isFinite(height) && height > 0 ? height : 600 };
}

/** ノート 1 件を .docx にする。 */
export async function exportDocxNote(
	notePath: string,
	signal: AbortSignal,
	settings: PluginSettings,
	manifest: ManifestSnapshot,
	deps: DocxExportDeps,
): Promise<NoteResult> {
	const files: FileResult[] = [];
	const warnings: Warning[] = [];
	const deleted: OutputRef[] = [];

	// 設定で有効なときだけ、Mermaid の画像ファイルも保存する（R8）。描画結果はキャッシュに残るので、下の埋め込みで再利用される
	if (settings.saveImageFiles) {
		const images = await exportMermaidNote(notePath, signal, settings, manifest, deps);
		files.push(...images.files);
		deleted.push(...images.deleted);
		warnings.push(...images.warnings.filter((w) => w.code !== "noDiagrams"));
	}

	// 構文解析・変換・埋め込みの展開・リンクの解決・画像の準備（フェーズ 3a）
	const vault = deps.vault ?? EMPTY_VAULT;
	const ownOutput = docxOutputRef(notePath, settings);
	const converted = convertedNotes(deps.convertedNotes, manifest);
	const { calloutColor, ...rest } = vault;
	const env: NoteEnvironment = {
		...rest,
		// テーマの色はオプションのときだけ読む（A-6）
		...(settings.calloutColorSource === "theme" && calloutColor ? { calloutColor } : {}),
		readNote: deps.readNote,
		isConverted: (path) => converted.has(path),
		docxLink: (target) => relativeUrl(ownOutput, docxOutputRef(target, settings)),
	};
	const assembled = await assembleNote(notePath, env, { keepComments: settings.keepCommentsAsWordComments, downloadExternalImages: settings.downloadExternalImages, signal });
	const { tree } = assembled;
	warnings.push(...assembled.warnings);
	const fm = mapFrontmatter(vault.frontmatter?.(notePath));

	const params = renderParams(settings);
	const diagrams = new Map<number, DiagramAsset>();
	for (const block of mermaidBlocksOf(tree)) {
		try {
			diagrams.set(block.index, await diagramAsset(block, params, deps, signal));
		} catch (error) {
			if (signal.aborted) throw error;
			// 描画に失敗した図は、ソースをコードブロックとして残す（R4）
			const detail = `${block.index}: ${error instanceof Error ? error.message : String(error)}`;
			if (!warnings.some((w) => w.code === "mermaidRenderFailed" && w.detail?.startsWith(`${block.index}:`))) warnings.push({ code: "mermaidRenderFailed", detail });
		}
	}

	if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
	const bytes = new Uint8Array(
		await renderDocx(tree, {
			title: fm.title ?? noteBaseName(notePath),
			creator: fm.author ?? settings.authorName,
			strictLineBreaks: deps.strictLineBreaks ?? settings.strictLineBreaksFallback,
			fileNameAsTitle: settings.fileNameAsTitle,
			page: { paperSize: settings.paperSize, orientation: settings.orientation, marginsMm: settings.marginsMm },
			fonts: {
				bodyEastAsia: settings.bodyFontEastAsia,
				bodyLatin: settings.bodyFontLatin,
				headingEastAsia: settings.headingFontEastAsia,
				headingLatin: settings.headingFontLatin,
			},
			diagrams,
			source: assembled.source,
			codeLineNumbers: settings.codeLineNumbers,
			comments: assembled.comments,
			properties: fm.properties,
			...(settings.frontmatterTable ? { propertiesTable: fm.table } : {}),
		}),
	);

	files.push(await writeWithConflictPolicy(ownOutput, bytes, settings.onConflict, deps, signal, "docx"));
	return { notePath, status: aggregateStatus(files), files, warnings, deleted };
}

/** 同名ファイルの設定（R3）に従って書き込む。予定動作は書き込みの時点の状態で判定し直す（.docx・.xlsx で共用）。 */
export async function writeWithConflictPolicy(
	output: OutputRef,
	bytes: Uint8Array,
	onConflict: PluginSettings["onConflict"],
	deps: Pick<MermaidExportDeps, "writer">,
	signal: AbortSignal,
	kind: "docx" | "xlsx",
): Promise<FileResult> {
	const action = plannedAction(await deps.writer.exists(output), false, onConflict);
	if (action === "skip") return { output, kind, status: "skipped", reason: "exists" };
	let target = output;
	if (action === "rename") target = await renamedRef(output, (ref) => deps.writer.exists(ref));
	const written = await deps.writer.write(target, bytes, signal);
	return { output: target, kind, ...written };
}

/** 連番を付けた出力先 `name (1).docx`。 */
export async function renamedRef(ref: OutputRef, exists: (ref: OutputRef) => Promise<boolean>): Promise<OutputRef> {
	const dot = ref.path.lastIndexOf(".");
	const stem = dot > ref.path.lastIndexOf("/") ? ref.path.slice(0, dot) : ref.path;
	const ext = dot > ref.path.lastIndexOf("/") ? ref.path.slice(dot) : "";
	for (let n = 1; n < 10000; n++) {
		const candidate = { location: ref.location, path: `${stem} (${n})${ext}` };
		if (!(await exists(candidate))) return candidate;
	}
	throw new Error(`no free name for ${ref.path}`);
}
