// 描画の部品（06: Mermaid の画像化・R1・R4）。Obsidian に同梱された mermaid.js を loadMermaid() で使う。
// mermaid.initialize() は呼ばない（Obsidian 本体のプレビューの表示を変えないため: R1）。設定はソースのディレクティブで渡す。
import { apiVersion, loadMermaid } from "obsidian";
import type { MermaidRenderer, RenderedDiagram } from "../core/mermaid-export";
import type { MermaidRenderParams } from "../core/mermaid";

interface MermaidApi {
	render(id: string, text: string): Promise<{ svg: string }>;
	version?: string;
}

let counter = 0;

export async function createMermaidRenderer(): Promise<MermaidRenderer> {
	const mermaid = (await loadMermaid()) as MermaidApi;
	const version = typeof mermaid.version === "string" ? mermaid.version : `obsidian-${apiVersion}`;
	return {
		version,
		render: (source, params, needPng, signal) => renderDiagram(mermaid, source, params, needPng, signal),
	};
}

async function renderDiagram(mermaid: MermaidApi, source: string, params: MermaidRenderParams, needPng: boolean, signal: AbortSignal): Promise<RenderedDiagram> {
	const id = `batch-office-export-${++counter}`;
	let raw: string;
	try {
		raw = (await mermaid.render(id, source)).svg;
	} finally {
		// mermaid が描画用に一時的に作った要素を片付ける（失敗したときに残ることがある）
		document.getElementById(id)?.remove();
		document.getElementById(`d${id}`)?.remove();
	}
	if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");

	const { svg, plainSvg, width, height } = normalizeSvg(raw);
	if (!needPng) return { svg, png: null };
	try {
		// PNG の背景は canvas で塗る（透過のオプションがあるため、背景なしの SVG から描く）
		return { svg, png: await svgToPng(plainSvg, width, height, params) };
	} catch (error) {
		// tainted canvas（SecurityError）など。SVG だけを返す
		return { svg, png: null, pngError: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
	}
}

/** 幅と高さを viewBox から決めて属性に書く。保存用の svg には白い背景を付ける（R4）。plainSvg は背景なし。 */
function normalizeSvg(raw: string): { svg: string; plainSvg: string; width: number; height: number } {
	const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
	const el = doc.documentElement;
	const viewBox = (el.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
	let width = viewBox.length === 4 && viewBox[2]! > 0 ? viewBox[2]! : parseFloat(el.getAttribute("width") ?? "") || 800;
	let height = viewBox.length === 4 && viewBox[3]! > 0 ? viewBox[3]! : parseFloat(el.getAttribute("height") ?? "") || 600;
	width = Math.ceil(width);
	height = Math.ceil(height);
	el.setAttribute("width", String(width));
	el.setAttribute("height", String(height));
	el.removeAttribute("style");
	const plainSvg = new XMLSerializer().serializeToString(el);
	el.setAttribute("style", "background-color: white;");
	return { svg: new XMLSerializer().serializeToString(el), plainSvg, width, height };
}

/** SVG を canvas に描いて PNG にする。大きさは DPI / 96 倍（R4）。pHYs は呼び出し側（core）で書き込む。 */
async function svgToPng(svg: string, width: number, height: number, params: MermaidRenderParams): Promise<Uint8Array> {
	const img = new Image();
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
	await img.decode();
	const scale = params.dpi / 96;
	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(width * scale);
	canvas.height = Math.ceil(height * scale);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d context is not available");
	if (!params.transparentBackground) {
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob>((resolve, reject) => {
		try {
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
		} catch (error) {
			reject(error);
		}
	});
	return new Uint8Array(await blob.arrayBuffer());
}
