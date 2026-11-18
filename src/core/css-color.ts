// CSS の色の値を Word の色（16 進 6 桁、大文字）にする。テーマのコールアウトの色（A-6 のオプション）を読むのに使う。
// Obsidian 1.15 の `--callout-color` は色そのもの（`#086ddd` など）。古いテーマは "r, g, b" の 3 つの数字で書く。
// ブラウザが計算した値（getComputedStyle の color）は `rgb(…)`・`rgba(…)`・`color(srgb …)` の形になる。

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex = (rgb: readonly number[]) => rgb.map((n) => clamp(n).toString(16).padStart(2, "0")).join("").toUpperCase();

/** 色の値を 16 進 6 桁にする。読めない値（キーワード、`var(…)`、`color-mix(…)` など）と完全に透明な色は undefined。 */
export function cssColorToHex(value: string): string | undefined {
	const v = value.trim().toLowerCase();
	if (v === "") return undefined;

	// "r, g, b"（古いテーマの --callout-color）
	const triplet = /^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/.exec(v);
	if (triplet) return hex(triplet.slice(1, 4).map(Number));

	// #rgb・#rgba・#rrggbb・#rrggbbaa（透明度は捨てる）
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(v);
	if (short) return hex(short.slice(1, 4).map((c) => Number.parseInt(c + c, 16)));
	const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(v);
	if (long) return hex(long.slice(1, 4).map((c) => Number.parseInt(c, 16)));

	// rgb(r, g, b)・rgba(r, g, b, a)・rgb(r g b / a)
	const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
	if (rgb) {
		if (rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) return undefined;
		return hex(rgb.slice(1, 4).map((c) => (c!.endsWith("%") ? (Number.parseFloat(c!) * 255) / 100 : Number.parseFloat(c!))));
	}

	// color(srgb r g b [/ a])（0〜1）
	const srgb = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(v);
	if (srgb) {
		if (srgb[4] !== undefined && Number.parseFloat(srgb[4]) === 0) return undefined;
		return hex(srgb.slice(1, 4).map((c) => Number.parseFloat(c!) * 255));
	}
	return undefined;
}
