// Obsidian に描画を依頼する処理（05: Obsidian に描画を依頼・フェーズ 3b）。
// - dataview・dataviewjs・他のプラグインのコードブロック: 画面の外に置いた要素で MarkdownRenderer.render() を呼び、
//   DOM の変化が止まるのを待って、結果を mdast にする（A-24・A-26）
// - 数式の画像: Obsidian 同梱の MathJax で SVG にする（A-11 の代替）
// - 外部の画像の取得（A-20 のオプション）、テーマのコールアウトの色（A-6 のオプション）
import { Component, MarkdownPreviewRenderer, MarkdownRenderer, loadMathJax, requestUrl, type App } from "obsidian";
import { domToMdast, type DomNodeLike } from "../core/dom-to-mdast";
import type { ImageAsset } from "../core/obsidian-syntax";
import { loadImage } from "./vault-env";

/** 0.5 秒続けて DOM が変わらなければ描画が終わったとみなす。1 依頼の上限は 10 秒（フェーズ 3b の決定事項）。 */
const QUIET_MS = 500;
const MAX_WAIT_MS = 10_000;
/** 外部の画像の上限（20 MB） */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** 描画しない言語（Mermaid はこのプラグインが描画する） */
const OWN_LANGUAGES = new Set(["mermaid"]);
const DATAVIEW_LANGUAGES = new Set(["dataview", "dataviewjs"]);

export interface PluginRenderer {
	renderableLanguage(lang: string): boolean;
	renderBlock(lang: string, source: string, sourcePath: string, signal?: AbortSignal): Promise<import("mdast").RootContent[] | null>;
	renderMath(latex: string, display: boolean): Promise<ImageAsset>;
	fetchImage(url: string): Promise<ImageAsset>;
	calloutColor(type: string): string | undefined;
}

export function createPluginRenderer(app: App): PluginRenderer {
	const colors = new Map<string, string | undefined>();
	return {
		renderableLanguage: (lang) => renderableLanguage(app, lang),
		renderBlock: (lang, source, sourcePath, signal) => renderBlock(app, lang, source, sourcePath, signal),
		renderMath,
		fetchImage,
		calloutColor: (type) => {
			if (!colors.has(type)) colors.set(type, readCalloutColor(type));
			return colors.get(type);
		},
	};
}

/** コードブロックの処理が登録されている言語か。登録の一覧（非公開）を読めなければ、Dataview が有効なときの dataview 系だけ。 */
function renderableLanguage(app: App, lang: string): boolean {
	const name = lang.toLowerCase();
	if (OWN_LANGUAGES.has(name)) return false;
	const processors = (MarkdownPreviewRenderer as unknown as { codeBlockPostProcessors?: Record<string, unknown> }).codeBlockPostProcessors;
	if (processors && typeof processors === "object") return Object.prototype.hasOwnProperty.call(processors, name);
	const plugins = (app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
	return DATAVIEW_LANGUAGES.has(name) && (plugins?.enabledPlugins?.has("dataview") ?? false);
}

async function renderBlock(app: App, lang: string, source: string, sourcePath: string, signal?: AbortSignal): Promise<import("mdast").RootContent[] | null> {
	if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
	// 画面の外に置く。大きさを測って描くプラグインのため、document にはつなぐ
	const host = document.createElement("div");
	host.className = "markdown-rendered batch-office-export-render";
	host.setAttribute("style", "position: fixed; left: -10000px; top: 0; width: 800px; visibility: hidden; pointer-events: none;");
	document.body.appendChild(host);
	const component = new Component();
	component.load();
	try {
		const longest = Math.max(0, ...(source.match(/`+/g) ?? []).map((m) => m.length));
		const fence = "`".repeat(Math.max(3, longest + 1));
		await MarkdownRenderer.render(app, `${fence}${lang}\n${source}\n${fence}`, host, sourcePath, component);
		await waitForQuiet(host, signal);
		if (isPlainCode(host)) return null;
		return await domToMdast(host as unknown as DomNodeLike, { image: (el) => rasterize(el as unknown as Element) });
	} finally {
		component.unload();
		host.remove();
	}
}

/** DOM の変化が QUIET_MS 続けて止まるまで待つ。上限を超えたら時間切れ、ノートのタイムアウトなら打ち切り。 */
function waitForQuiet(el: HTMLElement, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		let quiet = window.setTimeout(done, QUIET_MS);
		const limit = window.setTimeout(() => finish(new Error(`timeout (${MAX_WAIT_MS / 1000} s)`)), MAX_WAIT_MS);
		const observer = new MutationObserver(() => {
			window.clearTimeout(quiet);
			quiet = window.setTimeout(done, QUIET_MS);
		});
		const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
		observer.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
		signal?.addEventListener("abort", onAbort, { once: true });
		function done(): void {
			finish(null);
		}
		function finish(error: Error | null): void {
			observer.disconnect();
			window.clearTimeout(quiet);
			window.clearTimeout(limit);
			signal?.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve();
		}
	});
}

/** 処理が動かず、ふつうのコードブロックとして描かれただけか。 */
function isPlainCode(host: HTMLElement): boolean {
	const visual = host.querySelector("svg, canvas, img");
	if ((host.textContent ?? "").trim() === "" && !visual) return true;
	const other = host.querySelector("table, ul, ol, svg, canvas, img, p, h1, h2, h3, h4, h5, h6");
	return other === null && host.querySelector("pre > code") !== null;
}

/** svg・canvas・img を画像にする（svg は SVG + PNG の代替、canvas と img は PNG）。 */
async function rasterize(el: Element): Promise<ImageAsset | null> {
	const name = el.tagName.toLowerCase();
	const rect = el.getBoundingClientRect();
	if (name === "svg") {
		const clone = el.cloneNode(true) as SVGSVGElement;
		const viewBox = (el as SVGSVGElement).viewBox?.baseVal;
		const width = rect.width || viewBox?.width || 300;
		const height = rect.height || viewBox?.height || 150;
		clone.setAttribute("width", String(width));
		clone.setAttribute("height", String(height));
		if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		inlineUses(clone);
		const bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(clone));
		return loadImage(bytes, "svg");
	}
	if (name === "canvas") {
		const canvas = el as HTMLCanvasElement;
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!blob) return null;
		const data = new Uint8Array(await blob.arrayBuffer());
		return { type: "png", data, width: rect.width || canvas.width, height: rect.height || canvas.height };
	}
	if (name === "img") {
		const img = el as HTMLImageElement;
		if (!img.complete) await img.decode().catch(() => undefined);
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth || 1;
		canvas.height = img.naturalHeight || 1;
		canvas.getContext("2d")?.drawImage(img, 0, 0);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
		if (!blob) return null;
		return { type: "png", data: new Uint8Array(await blob.arrayBuffer()), width: img.naturalWidth || rect.width, height: img.naturalHeight || rect.height };
	}
	return null;
}

/** `<use href="#id">` が文書の別の場所を指しているとき、その要素を SVG の中に写す（MathJax の共有のフォントキャッシュなど）。 */
function inlineUses(svg: SVGSVGElement): void {
	let defs = svg.querySelector("defs");
	for (const use of Array.from(svg.querySelectorAll("use"))) {
		const href = use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
		if (!href.startsWith("#")) continue;
		const id = href.slice(1);
		if (svg.querySelector(`[id="${CSS.escape(id)}"]`)) continue;
		const target = document.getElementById(id);
		if (!target) continue;
		if (!defs) {
			defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
			svg.insertBefore(defs, svg.firstChild);
		}
		defs.appendChild(target.cloneNode(true));
	}
	// xlink:href は名前空間の宣言がないと読めないので、href にそろえる
	for (const use of Array.from(svg.querySelectorAll("use"))) {
		const href = use.getAttribute("xlink:href");
		if (href && !use.getAttribute("href")) use.setAttribute("href", href);
	}
}

/** MathJax で数式を SVG にする。ex の単位は px にする（1 ex = 8 px で近似）。 */
async function renderMath(latex: string, display: boolean): Promise<ImageAsset> {
	await loadMathJax();
	const mathJax = (window as unknown as { MathJax?: { tex2svg?: (tex: string, options: { display: boolean }) => HTMLElement } }).MathJax;
	if (!mathJax?.tex2svg) throw new Error("MathJax is not available");
	const container = mathJax.tex2svg(latex, { display });
	if (container.querySelector('[data-mml-node="merror"]')) throw new Error("MathJax could not read the formula");
	const svg = container.querySelector("svg");
	if (!svg) throw new Error("MathJax returned no SVG");
	const toPx = (value: string | null) => {
		const m = /^([\d.]+)ex$/.exec(value ?? "");
		return m ? Number(m[1]) * 8 : Number.parseFloat(value ?? "") || 0;
	};
	const clone = svg.cloneNode(true) as SVGSVGElement;
	const width = toPx(svg.getAttribute("width")) || 100;
	const height = toPx(svg.getAttribute("height")) || 20;
	clone.setAttribute("width", String(width));
	clone.setAttribute("height", String(height));
	clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	clone.removeAttribute("style");
	inlineUses(clone);
	return loadImage(new TextEncoder().encode(new XMLSerializer().serializeToString(clone)), "svg");
}

const MIME_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
	"image/avif": "avif",
};

async function fetchImage(url: string): Promise<ImageAsset> {
	const response = await requestUrl({ url, throw: false });
	if (response.status >= 400) throw new Error(`HTTP ${response.status}`);
	const bytes = new Uint8Array(response.arrayBuffer);
	if (bytes.byteLength > MAX_DOWNLOAD_BYTES) throw new Error(`larger than ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB`);
	const type = (response.headers["content-type"] ?? response.headers["Content-Type"] ?? "").split(";")[0]!.trim().toLowerCase();
	const fromUrl = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
	const ext = MIME_EXTENSIONS[type] ?? fromUrl ?? "png";
	return loadImage(bytes, ext === "jpeg" ? "jpg" : ext);
}

/** テーマのコールアウトの色（`--callout-color` の "r, g, b"）を 16 進 6 桁にする。 */
function readCalloutColor(type: string): string | undefined {
	const wrapper = document.createElement("div");
	wrapper.className = "markdown-rendered batch-office-export-render";
	wrapper.setAttribute("style", "position: fixed; left: -10000px; top: 0; visibility: hidden;");
	const callout = document.createElement("div");
	callout.className = "callout";
	callout.setAttribute("data-callout", type);
	wrapper.appendChild(callout);
	document.body.appendChild(wrapper);
	try {
		const value = getComputedStyle(callout).getPropertyValue("--callout-color").trim();
		const parts = value.split(",").map((p) => Number(p.trim()));
		if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined;
		return parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
	} finally {
		wrapper.remove();
	}
}
