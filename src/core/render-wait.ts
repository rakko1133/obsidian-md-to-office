// Obsidian の描画の完了待ち（05・H1-PDF）の時間の決め方。Obsidian API に依存しない。
// 待ち方: render() が戻った後、DOM の最初の変化を firstChangeMs まで待ち、変化があれば、それから settleMs 変化が止まるまで待つ。
// 2026-11-19 の計測（docs/design/performance.md）: Dataview は render() の約 100〜125 ms 後に描画を始め、変化はその後 25 ms ほどで終わる。
// 非同期に描くものがないノートでは、DOM はまったく変わらなかった（PDF 47 件中 44 件）。

/** 非同期に描くもの（他のプラグインのコードブロック・ノートの埋め込み・Dataview のインラインクエリ）があるときの、最初の変化を待つ時間。 */
export const FIRST_CHANGE_MS = 500;
/** 非同期に描くものがないときの、最初の変化を待つ時間（念のため少しだけ待つ。計測では、変化があっても render() の直後だった）。 */
export const STATIC_FIRST_CHANGE_MS = 30;
/** 変化があった後、変化が止まったとみなす時間。 */
export const SETTLE_MS = 200;
/** 1 依頼の上限（フェーズ 3b の決定事項）。 */
export const MAX_WAIT_MS = 10_000;

export interface QuietTiming {
	firstChangeMs: number;
	settleMs: number;
}

/** 他のプラグインのコードブロックだけを描く（05: 必ず非同期に描かれうる）。 */
export const PLUGIN_BLOCK_TIMING: QuietTiming = { firstChangeMs: FIRST_CHANGE_MS, settleMs: SETTLE_MS };

const FENCE = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([^\s`{]+)/gm;
const NOTE_EMBED = /!\[\[([^\]|#^]*)/g;
const INLINE_QUERY = /`\$?=/;
const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|pdf|mp3|wav|m4a|ogg|webm|mp4|mov|mkv)$/i;

/**
 * ノート全体を描くとき（PDF）、render() が戻った後に非同期に描かれうるものがあるか。
 * 他のプラグインのコードブロック（renderable）、ノートの埋め込み（中に何があるか分からない）、Dataview のインラインクエリ（`= …`・`$= …`）。
 */
export function mayRenderLater(markdown: string, renderable: (lang: string) => boolean): boolean {
	return ownContentMayRenderLater(markdown, renderable) || noteEmbeds(markdown).length > 0;
}

/** ノートの中身（埋め込みを除く）に、非同期に描かれうるものがあるか。 */
function ownContentMayRenderLater(markdown: string, renderable: (lang: string) => boolean): boolean {
	for (const m of markdown.matchAll(FENCE)) if (renderable(m[1])) return true;
	return INLINE_QUERY.test(markdown);
}

/** 埋め込みのリンク先（画像などの添付ファイルを除く。`![[名前#見出し|別名]]` の「名前」）。 */
export function noteEmbeds(markdown: string): string[] {
	const out: string[] = [];
	for (const m of markdown.matchAll(NOTE_EMBED)) {
		const link = m[1].trim();
		if (link !== "" && !ATTACHMENT_EXT.test(link)) out.push(link);
	}
	return out;
}

/** 埋め込みのリンク先の読み込み。ノート（.md）なら中身、解決できなければ "missing"、ノート以外（Canvas など）は "other"。 */
export type EmbedReader = (link: string, fromPath: string) => Promise<{ path: string; markdown: string } | "missing" | "other">;

/** 埋め込みをたどる深さの上限（Obsidian の埋め込みの入れ子の上限に合わせて浅めにする） */
const MAX_EMBED_DEPTH = 5;

/**
 * mayRenderLater の埋め込みをたどる版: 埋め込んだノートの中身も調べる。
 * 解決できない埋め込みは Obsidian がその場で「ない」と描くので false、ノート以外の埋め込みと深すぎる入れ子は true（安全側）。
 */
export async function mayRenderLaterDeep(path: string, markdown: string, renderable: (lang: string) => boolean, read: EmbedReader): Promise<boolean> {
	const visited = new Set<string>([path]);
	const visit = async (from: string, text: string, depth: number): Promise<boolean> => {
		if (ownContentMayRenderLater(text, renderable)) return true;
		for (const link of noteEmbeds(text)) {
			if (depth >= MAX_EMBED_DEPTH) return true;
			const target = await read(link, from);
			if (target === "missing") continue;
			if (target === "other") return true;
			if (visited.has(target.path)) continue;
			visited.add(target.path);
			if (await visit(target.path, target.markdown, depth + 1)) return true;
		}
		return false;
	};
	return visit(path, markdown, 0);
}

/** ノート全体を描くときの待ち方。 */
export function noteTiming(markdown: string, renderable: (lang: string) => boolean): QuietTiming {
	return timingFor(mayRenderLater(markdown, renderable));
}

/** 非同期に描かれうるものの有無からの待ち方。 */
export function timingFor(mayRender: boolean): QuietTiming {
	return { firstChangeMs: mayRender ? FIRST_CHANGE_MS : STATIC_FIRST_CHANGE_MS, settleMs: SETTLE_MS };
}
