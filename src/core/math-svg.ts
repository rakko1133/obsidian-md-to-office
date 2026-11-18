// LaTeX → SVG（A-11 の代替）。latexToMath で Word の数式にできない式を、同梱の MathJax（mathjax-full）で SVG にする。
// Obsidian に同梱の MathJax は CHTML 出力だけで SVG を作れないため、SVG 出力を持つ MathJax をプラグインに含める。
// DOM を使わない liteAdaptor で動くので、Obsidian の外（単体テスト）でも同じ結果になる。
import { liteAdaptor, type LiteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";
// TeX の拡張。AllPackages.js は使わない: グローバルに MathJax があると MathJax.loader.preLoad を呼ぶが、
// Obsidian のグローバルの MathJax（同梱の CHTML 版）にはそれがなく、プラグインの読み込みが失敗する。
// 一覧は AllPackages.js と同じで、読めない命令を赤字で描く noerrors・noundefined だけを除く
import "mathjax-full/js/input/tex/base/BaseConfiguration.js";
import "mathjax-full/js/input/tex/action/ActionConfiguration.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/amscd/AmsCdConfiguration.js";
import "mathjax-full/js/input/tex/bbox/BboxConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/braket/BraketConfiguration.js";
import "mathjax-full/js/input/tex/bussproofs/BussproofsConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/cases/CasesConfiguration.js";
import "mathjax-full/js/input/tex/centernot/CenternotConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/colortbl/ColortblConfiguration.js";
import "mathjax-full/js/input/tex/empheq/EmpheqConfiguration.js";
import "mathjax-full/js/input/tex/enclose/EncloseConfiguration.js";
import "mathjax-full/js/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "mathjax-full/js/input/tex/gensymb/GensymbConfiguration.js";
import "mathjax-full/js/input/tex/html/HtmlConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/upgreek/UpgreekConfiguration.js";
import "mathjax-full/js/input/tex/unicode/UnicodeConfiguration.js";
import "mathjax-full/js/input/tex/verb/VerbConfiguration.js";
import "mathjax-full/js/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "mathjax-full/js/input/tex/tagformat/TagFormatConfiguration.js";
import "mathjax-full/js/input/tex/textcomp/TextcompConfiguration.js";
import "mathjax-full/js/input/tex/textmacros/TextMacrosConfiguration.js";

/** MathJax の長さの単位 ex を px にする係数（1 ex ≒ 8 px で近似） */
const PX_PER_EX = 8;
/** 使う TeX の拡張（上で読み込んだもの） */
const PACKAGES = ["base", "action", "ams", "amscd", "bbox", "boldsymbol", "braket", "bussproofs", "cancel", "cases", "centernot", "color", "colortbl", "empheq", "enclose", "extpfeil", "gensymb", "html", "mathtools", "mhchem", "newcommand", "upgreek", "unicode", "verb", "configmacros", "tagformat", "textcomp", "textmacros"];

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
			packages: PACKAGES,
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
