// SVG の CSS 変数（`var(--name, 既定値)`）を実際の値に置き換える（R4・A-12 の不具合の修正: フェーズ 3b）。
// いまの Obsidian の Mermaid は、色を CSS 変数で指定した SVG を出す。Word の SVG の描画は CSS 変数を解釈しないため、
// 塗りがすべて黒になる。埋め込む前と保存する前に、文字列のまま置き換える。Obsidian API に依存しない。

const MAX_DEPTH = 10;

/** SVG の中の `--name: 値` の宣言を集める（style 属性と <style> の両方）。同じ名前は最初の宣言を使う。 */
export function collectCssVariables(svg: string): Map<string, string> {
	const defs = new Map<string, string>();
	for (const m of svg.matchAll(/(?:^|[;{\s"'])--([A-Za-z0-9_-]+)\s*:\s*/g)) {
		const name = m[1]!;
		const start = m.index! + m[0].length;
		const value = readValue(svg, start);
		if (!defs.has(name)) defs.set(name, value.trim());
	}
	return defs;
}

/** 宣言の値を `;`・`}`・引用符の終わりまで読む（括弧の中の `;` は読み飛ばす）。 */
function readValue(text: string, start: number): string {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const ch = text[i]!;
		if (ch === "(") depth++;
		else if (ch === ")") depth = Math.max(0, depth - 1);
		else if (depth === 0 && (ch === ";" || ch === "}" || ch === '"' || ch === "'")) return text.slice(start, i);
	}
	return text.slice(start);
}

/**
 * `var(--name, 既定値)` を、宣言の値か既定値に置き換える。どちらもなければ空にする。
 * `currentColor` も、SVG の中の最初の `color:` の値（なければ黒）に置き換える（Word は解釈しないため）。
 */
export function resolveCssVariables(svg: string): string {
	let out = svg;
	if (out.includes("var(")) out = substitute(out, collectCssVariables(out), new Set());
	if (/currentColor/i.test(out)) {
		const color = /(?:^|[;{\s"'])color\s*:\s*([^;"'}]+)/.exec(out)?.[1]?.trim() || "#000000";
		out = out.replace(/currentColor/gi, color);
	}
	return out;
}

/** active は置き換えの途中の名前（自分自身を参照する宣言では、その名前を既定値に落とす）。 */
function substitute(text: string, defs: ReadonlyMap<string, string>, active: ReadonlySet<string>): string {
	if (active.size > MAX_DEPTH || !text.includes("var(")) return text;
	let out = "";
	let i = 0;
	while (i < text.length) {
		const at = text.indexOf("var(", i);
		if (at === -1) {
			out += text.slice(i);
			break;
		}
		out += text.slice(i, at);
		// 対応する閉じ括弧を探す
		let level = 0;
		let end = -1;
		for (let k = at + 3; k < text.length; k++) {
			if (text[k] === "(") level++;
			else if (text[k] === ")") {
				level--;
				if (level === 0) {
					end = k;
					break;
				}
			}
		}
		if (end === -1) {
			out += text.slice(at);
			break;
		}
		const inner = text.slice(at + 4, end);
		const comma = inner.indexOf(",");
		const name = (comma === -1 ? inner : inner.slice(0, comma)).trim().replace(/^--/, "");
		const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
		const value = active.has(name) ? undefined : defs.get(name);
		if (value !== undefined && value !== "") out += substitute(value, defs, new Set([...active, name]));
		else out += substitute(fallback ?? "", defs, active);
		i = end + 1;
	}
	return out;
}

