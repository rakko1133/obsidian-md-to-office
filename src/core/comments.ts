// コメント `%%…%%` の除去（A-16・フェーズ 3 の決定事項）。構文解析の前に、Markdown の文字列に対して行う。
// コードブロック（``` / ~~~ の囲み）とインラインコードの中は除く（Mermaid の `%%` を消さないため）。
// 閉じていない `%%` は、Obsidian と同じく文書の最後までをコメントとして扱う。
// Obsidian API に依存しない。

/** Word のコメントとして残すときに、コメントの位置に置く印（私用領域の文字）。 */
export const COMMENT_MARK_START = "";
export const COMMENT_MARK_END = "";
export const COMMENT_MARK = /(\d+)/g;

export interface StrippedComments {
	/** コメントを除いた Markdown。keepMarkers のときは、コメントの位置に印 `{n}` を置く */
	text: string;
	/** コメントの中身（前後の空白を除く）。n 番目が印の番号 n に対応する */
	comments: string[];
}

export function stripComments(markdown: string, keepMarkers = false): StrippedComments {
	const comments: string[] = [];
	let out = "";
	let i = 0;
	let fence: string | null = null; // 開いているコードブロックの囲み（``` や ~~~）
	const n = markdown.length;

	while (i < n) {
		const atLineStart = i === 0 || markdown[i - 1] === "\n";
		if (atLineStart) {
			const lineEnd = markdown.indexOf("\n", i);
			const line = markdown.slice(i, lineEnd === -1 ? n : lineEnd + 1);
			const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
			if (fence !== null) {
				// コードブロックの中: 閉じる囲みまでそのまま写す
				if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
				out += line;
				i += line.length;
				continue;
			}
			if (m) {
				fence = m[1]!;
				out += line;
				i += line.length;
				continue;
			}
		}

		const ch = markdown[i];
		if (ch === "`") {
			// インラインコード: 同じ長さのバッククォートの並びで閉じる（空行はまたがない）
			let run = 1;
			while (markdown[i + run] === "`") run++;
			const ticks = "`".repeat(run);
			const close = findClosingTicks(markdown, i + run, ticks);
			if (close !== -1) {
				out += markdown.slice(i, close + run);
				i = close + run;
			} else {
				out += ticks;
				i += run;
			}
			continue;
		}
		if (ch === "%" && markdown[i + 1] === "%") {
			const close = markdown.indexOf("%%", i + 2);
			const body = markdown.slice(i + 2, close === -1 ? n : close);
			comments.push(body.trim());
			if (keepMarkers) out += `${COMMENT_MARK_START}${comments.length - 1}${COMMENT_MARK_END}`;
			i = close === -1 ? n : close + 2;
			continue;
		}
		out += ch;
		i++;
	}
	return { text: out, comments };
}

function findClosingTicks(text: string, from: number, ticks: string): number {
	let i = from;
	while (i < text.length) {
		const at = text.indexOf(ticks, i);
		if (at === -1) return -1;
		// 空行をまたいだら閉じていないとみなす
		if (/\n[ \t]*\n/.test(text.slice(from, at))) return -1;
		// 長さがちょうど同じ並びだけを閉じとみなす
		if (text[at + ticks.length] !== "`" && text[at - 1] !== "`") return at;
		i = at + ticks.length;
		while (text[i] === "`") i++;
	}
	return -1;
}
