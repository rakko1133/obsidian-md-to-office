// Vault の読み取りとリンクの解決（フェーズ 3a の VaultEnvironment の実装）。
// - リンク: metadataCache.getFirstLinkpathDest（A-18）
// - 画像: Vault からバイト列を読み、Word が扱えない形式（WebP・GIF・BMP・AVIF）は canvas で PNG にする。SVG には PNG の代替画像を付ける（A-20）
// - コードの色付け: Obsidian 同梱の Prism（loadPrism）でトークンに分ける（A-7）
// - frontmatter: metadataCache のキャッシュ（A-27）
// - フェーズ 3b の描画依頼などは plugin-render.ts
import { TFile, loadPrism, type App } from "obsidian";
import { svgSize, type VaultEnvironment } from "../core/docx-export";
import { resolveCssVariables } from "../core/svg-css";
import type { CodeToken, ImageAsset } from "../core/obsidian-syntax";
import { createPluginRenderer } from "./plugin-render";
import { timed } from "../core/profile";

/** SVG の PNG の代替画像の倍率（96 dpi の 2 倍 = 192 dpi。Mermaid の既定と同じ）。 */
const SVG_FALLBACK_SCALE = 2;

export async function createVaultEnvironment(app: App): Promise<VaultEnvironment> {
	const prism = (await loadPrism().catch(() => null)) as PrismLike | null;
	const plugins = createPluginRenderer(app);
	const fileOf = (path: string): TFile => {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`not found: ${path}`);
		return file;
	};
	return {
		resolveLink: (linkpath, sourcePath) => app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null,
		fileExists: (path) => app.vault.getAbstractFileByPath(path) instanceof TFile,
		vaultName: app.vault.getName(),
		frontmatter: (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			return file instanceof TFile ? (app.metadataCache.getFileCache(file)?.frontmatter) : undefined;
		},
		loadImage: async (path) => {
			const bytes = new Uint8Array(await timed("asset/loadImage/read", () => app.vault.readBinary(fileOf(path))));
			return timed("asset/loadImage/convert", () => loadImage(bytes, fileOf(path).extension.toLowerCase()));
		},
		highlight: (code, lang) => (prism ? tokenize(prism, code, lang) : null),
		// フェーズ 3b: 他のプラグインの描画・数式の画像・外部の画像・テーマのコールアウトの色
		renderableLanguage: plugins.renderableLanguage,
		renderBlock: plugins.renderBlock,
		renderMath: plugins.renderMath,
		fetchImage: plugins.fetchImage,
		calloutColor: plugins.calloutColor,
	};
}

/** 画像のバイト列を、Word が扱える形式にする（描画結果・外部の画像でも使う）。 */
export async function loadImage(bytes: Uint8Array, ext: string): Promise<ImageAsset> {
	if (ext === "svg") {
		// Word は CSS 変数を解釈しないので、実際の値に置き換える（他のプラグインの描画結果の SVG など）
		const text = resolveCssVariables(new TextDecoder().decode(bytes));
		bytes = new TextEncoder().encode(text);
		const img = await decode(new Blob([bytes as BlobPart], { type: "image/svg+xml" }));
		const fromAttr = svgSize(text);
		const width = img.naturalWidth || fromAttr.width;
		const height = img.naturalHeight || fromAttr.height;
		const fallback = await toPng(img, width * SVG_FALLBACK_SCALE, height * SVG_FALLBACK_SCALE, true);
		return { type: "svg", data: bytes, fallback, width, height };
	}
	const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
	const img = await decode(new Blob([bytes as BlobPart], { type: mime }));
	const width = img.naturalWidth;
	const height = img.naturalHeight;
	if (ext === "png") return { type: "png", data: bytes, width, height };
	if (ext === "jpg" || ext === "jpeg") return { type: "jpg", data: bytes, width, height };
	// WebP・GIF（最初のコマ）・BMP・AVIF は PNG にする
	return { type: "png", data: await toPng(img, width, height, false), width, height };
}

async function decode(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		return img;
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function toPng(img: HTMLImageElement, width: number, height: number, whiteBackground: boolean): Promise<Uint8Array> {
	const canvas = createEl("canvas");
	canvas.width = Math.max(1, Math.ceil(width));
	canvas.height = Math.max(1, Math.ceil(height));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d context is not available");
	if (whiteBackground) {
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob>((resolve, reject) => {
		try {
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
	return new Uint8Array(await blob.arrayBuffer());
}

interface PrismToken {
	type: string;
	alias?: string | string[];
	content: string | PrismToken | (string | PrismToken)[];
}

interface PrismLike {
	languages: Record<string, unknown>;
	tokenize(code: string, grammar: unknown): (string | PrismToken)[];
}

/** Prism のトークンの木を、種類の並び付きの平らな列にする。 */
function tokenize(prism: PrismLike, code: string, lang: string): CodeToken[] | null {
	const grammar = prism.languages[lang.toLowerCase()];
	if (!grammar || typeof grammar !== "object") return null;
	const out: CodeToken[] = [];
	const visit = (node: string | PrismToken | (string | PrismToken)[], types: string[]): void => {
		if (typeof node === "string") {
			if (node !== "") out.push({ text: node, types });
		} else if (Array.isArray(node)) {
			for (const child of node) visit(child, types);
		} else {
			const aliases = node.alias === undefined ? [] : Array.isArray(node.alias) ? node.alias : [node.alias];
			visit(node.content, [...types, node.type, ...aliases]);
		}
	};
	visit(prism.tokenize(code, grammar), []);
	return out;
}
