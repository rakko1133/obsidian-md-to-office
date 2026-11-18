// ノート 1 件分の Mermaid 画像化（06 → 09 の流れ・R1・R4）と、そのドライラン（02）。
// 描画・キャッシュ・書き込みは引数で受け取る部品に任せ、Obsidian API に依存しない。
import { buildRenderSource, diagramHash, extractMermaidBlocks, imageExtensions, imageFileName, type MermaidRenderParams } from "./mermaid";
import { findOldImages, joinPath, noteBaseName, outputDirFor } from "./output-plan";
import { setPngDpi } from "./png";
import { aggregateStatus } from "./run";
import type { PluginSettings } from "./settings";
import type { FileResult, ManifestSnapshot, NoteResult, OutputRef, PlannedAction, Warning } from "./types";

/** 描画の部品（src/obsidian/mermaid-renderer.ts）。 */
export interface MermaidRenderer {
	/** mermaid.js のバージョン（ハッシュの入力: R4） */
	readonly version: string;
	/** SVG を描画する。needPng なら PNG（DPI 倍の大きさ、pHYs なし）も作る。PNG 化だけ失敗したら png は null で pngError に理由 */
	render(source: string, params: MermaidRenderParams, needPng: boolean, signal: AbortSignal): Promise<RenderedDiagram>;
}

export interface RenderedDiagram {
	svg: string;
	png: Uint8Array | null;
	pngError?: string;
}

/** 専用キャッシュ（フェーズ 1 の決定事項）。 */
export interface DiagramCache {
	get(hash: string, ext: "svg" | "png"): Promise<Uint8Array | null>;
	put(hash: string, ext: "svg" | "png", bytes: Uint8Array): Promise<void>;
}

/** 書き込みの部品（09: src/obsidian/fs-writer.ts）。 */
export interface OutputWriter {
	exists(ref: OutputRef): Promise<boolean>;
	/** アトミックに書き込み、内容ハッシュを返す。使用中などで書けなければ skipped、それ以外の失敗は failed */
	write(ref: OutputRef, bytes: Uint8Array, signal: AbortSignal): Promise<Pick<FileResult, "status" | "reason" | "contentHash">>;
	/** 既存ファイルの内容ハッシュ（変更なしのときの記録用）。読めなければ null */
	hashOf(ref: OutputRef): Promise<string | null>;
	/** 古い画像を削除する。削除できたら true */
	remove(ref: OutputRef): Promise<boolean>;
}

export interface MermaidExportDeps {
	readNote(notePath: string): Promise<string>;
	renderer: MermaidRenderer;
	cache: DiagramCache;
	writer: OutputWriter;
}

export function renderParams(settings: Pick<PluginSettings, "mermaidFontFamily" | "pngDpi" | "pngTransparentBackground">): MermaidRenderParams {
	return {
		theme: "neutral",
		fontFamily: settings.mermaidFontFamily,
		dpi: settings.pngDpi,
		transparentBackground: settings.pngTransparentBackground,
	};
}

/** ドライランの 1 件（02 の確認画面に出す）。 */
export interface PlannedImage {
	output: OutputRef;
	diagramIndex: number;
	action: PlannedAction;
}

/** ノート 1 件のドライラン。描画はせず、ハッシュから出力パスを計算して、既存ファイルの有無で予定動作を決める。 */
export async function planMermaidNote(
	notePath: string,
	markdown: string,
	settings: PluginSettings,
	mermaidVersion: string,
	exists: (ref: OutputRef) => Promise<boolean>,
): Promise<PlannedImage[]> {
	const params = renderParams(settings);
	const dir = outputDirFor(notePath, settings);
	const plans: PlannedImage[] = [];
	for (const block of extractMermaidBlocks(markdown)) {
		const hash = await diagramHash(block.source, params, mermaidVersion);
		for (const ext of imageExtensions(settings.mermaidImageFormat)) {
			const output: OutputRef = { location: dir.location, path: joinPath(dir.path, imageFileName(noteBaseName(notePath), block.index, hash, ext)) };
			plans.push({ output, diagramIndex: block.index, action: (await exists(output)) ? "unchanged" : "create" });
		}
	}
	return plans;
}

/** ノート 1 件の Mermaid の図を画像ファイルとして保存する（R1 の単独保存）。 */
export async function exportMermaidNote(
	notePath: string,
	signal: AbortSignal,
	settings: PluginSettings,
	manifest: ManifestSnapshot,
	deps: MermaidExportDeps,
): Promise<NoteResult> {
	const markdown = await deps.readNote(notePath);
	const blocks = extractMermaidBlocks(markdown);
	const warnings: Warning[] = [];
	if (blocks.length === 0) {
		return { notePath, status: "skipped", files: [], warnings: [{ code: "noDiagrams" }], reason: "noDiagrams", deleted: [] };
	}

	const params = renderParams(settings);
	const dir = outputDirFor(notePath, settings);
	const base = noteBaseName(notePath);
	const files: FileResult[] = [];
	const deleted: OutputRef[] = [];

	for (const block of blocks) {
		throwIfAborted(signal);
		const hash = await diagramHash(block.source, params, deps.renderer.version);
		const refFor = (ext: "svg" | "png"): OutputRef => ({ location: dir.location, path: joinPath(dir.path, imageFileName(base, block.index, hash, ext)) });

		let wanted = imageExtensions(settings.mermaidImageFormat);
		const blockFiles: FileResult[] = [];
		let rendered: RenderedDiagram | null = null;

		const bytesFor = async (ext: "svg" | "png"): Promise<Uint8Array | null> => {
			const cached = await deps.cache.get(hash, ext).catch(() => null);
			if (cached) return cached;
			if (!rendered) {
				throwIfAborted(signal);
				rendered = await deps.renderer.render(buildRenderSource(block.source, params), params, wanted.includes("png"), signal);
				const svgBytes = new TextEncoder().encode(rendered.svg);
				await deps.cache.put(hash, "svg", svgBytes).catch(() => warnings.push({ code: "cacheFailed", detail: String(block.index) }));
				if (rendered.png) {
					rendered.png = setPngDpi(rendered.png, params.dpi);
					await deps.cache.put(hash, "png", rendered.png).catch(() => warnings.push({ code: "cacheFailed", detail: String(block.index) }));
				}
			}
			return ext === "svg" ? new TextEncoder().encode(rendered.svg) : rendered.png;
		};

		try {
			for (let i = 0; i < wanted.length; i++) {
				const ext = wanted[i]!;
				const output = refFor(ext);
				if (await deps.writer.exists(output)) {
					const contentHash = (await deps.writer.hashOf(output)) ?? undefined;
					blockFiles.push({ output, kind: "image", status: "unchanged", diagramIndex: block.index, ...(contentHash ? { contentHash } : {}) });
					continue;
				}
				const bytes = await bytesFor(ext);
				if (!bytes) {
					// PNG 化だけ失敗した（tainted canvas など）: SVG だけを保存して警告する
					const r = rendered as RenderedDiagram | null;
					warnings.push({ code: "pngFailedSvgOnly", detail: `${block.index}: ${r?.pngError ?? ""}` });
					if (!wanted.includes("svg")) wanted = [...wanted, "svg"];
					continue;
				}
				throwIfAborted(signal);
				const written = await deps.writer.write(output, bytes, signal);
				blockFiles.push({ output, kind: "image", diagramIndex: block.index, ...written });
			}
		} catch (error) {
			if (signal.aborted) throw error;
			warnings.push({ code: "mermaidRenderFailed", detail: `${block.index}: ${error instanceof Error ? error.message : String(error)}` });
			blockFiles.push({ output: refFor(wanted[0]!), kind: "image", status: "failed", diagramIndex: block.index, reason: "render" });
		}
		files.push(...blockFiles);

		// 新しい画像をすべて書き終えた図だけ、古い画像を消す（R4）
		const ok = blockFiles.length > 0 && blockFiles.every((f) => f.status === "success" || f.status === "unchanged");
		if (ok) {
			for (const old of findOldImages(manifest, notePath, block.index, blockFiles.map((f) => f.output))) {
				if (await deps.writer.remove(old)) deleted.push(old);
			}
		}
	}

	return { notePath, status: aggregateStatus(files), files, warnings, deleted };
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
}
