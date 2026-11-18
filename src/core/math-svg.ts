// LaTeX → SVG（A-11 の代替）。latexToMath で Word の数式にできない式を、同梱の MathJax（mathjax-full）で SVG にする。
// Obsidian に同梱の MathJax は CHTML 出力だけで SVG を作れないため、SVG 出力を持つ MathJax をプラグインに含める。
// DOM を使わない liteAdaptor で動くので、Obsidian の外（単体テスト）でも同じ結果になる。
import { liteAdaptor, type LiteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

/** MathJax の長さの単位 ex を px にする係数（1 ex ≒ 8 px で近似） */
const PX_PER_EX = 8;
/** 読めない命令を赤字で描く拡張は使わない（読めない式は例外にして、呼び出し側で LaTeX のまま残す） */
const EXCLUDED_PACKAGES = new Set(["noerrors", "noundefined"]);

export interface MathSvg {
	/** 単体で表示できる SVG（xmlns 付き、width / height は px） */
	svg: string;
	width: number;
	height: number;
}

interface MathDocument {
	convert(math: string, options: { display: boolean }): unknown;
}

let state: { adaptor: LiteAdaptor; doc: MathDocument } | undefined;

function documentForMath(): { adaptor: LiteAdaptor; doc: MathDocument } {
	if (!state) {
		const adaptor = liteAdaptor();
		RegisterHTMLHandler(adaptor);
		const tex = new TeX({
			packages: AllPackages.filter((p) => !EXCLUDED_PACKAGES.has(p)),
			// 構文の誤りは赤字の merror にせず例外にする
			formatError: (_jax: unknown, error: Error) => {
				throw error;
			},
		});
		// fontCache: none で、字形を <use> で参照せず、各文字のパスを SVG の中に直接書く（Word で単体の画像として描けるように）
		const svg = new SVG({ fontCache: "none" });
		state = { adaptor, doc: mathjax.document("", { InputJax: tex, OutputJax: svg }) as MathDocument };
	}
	return state;
}

/** LaTeX を SVG にする。MathJax が読めない式は例外を投げる。 */
export function texToSvg(latex: string, display: boolean): MathSvg {
	const { adaptor, doc } = documentForMath();
	const container = doc.convert(latex, { display }) as Parameters<LiteAdaptor["firstChild"]>[0];
	const svgNode = adaptor.firstChild(container) as Parameters<LiteAdaptor["outerHTML"]>[0];
	let svg = adaptor.outerHTML(svgNode);
	if (svg.includes('data-mml-node="merror"')) throw new Error("MathJax could not read the formula");
	const toPx = (name: string, fallback: number) => {
		const m = new RegExp(`\\s${name}="([\\d.]+)ex"`).exec(svg);
		return m ? Math.round(Number(m[1]) * PX_PER_EX * 100) / 100 : fallback;
	};
	const width = toPx("width", 100);
	const height = toPx("height", 20);
	svg = svg
		.replace(/\swidth="[\d.]+ex"/, ` width="${width}"`)
		.replace(/\sheight="[\d.]+ex"/, ` height="${height}"`)
		// 行の中での縦位置（vertical-align）の指定は、画像にするときには使わない
		.replace(/\sstyle="[^"]*"/, "")
		// Word の SVG の描画は currentColor を解釈しないので、文字色（黒）を直接書く
		.replace(/currentColor/g, "#000000");
	if (!svg.includes("xmlns=")) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
	return { svg, width, height };
}
