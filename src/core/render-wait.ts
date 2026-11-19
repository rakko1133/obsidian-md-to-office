// Obsidian の描画の完了待ち（05・H1-PDF）の時間の決め方。Obsidian API に依存しない。
// 待ち方: render() が戻った後、DOM の最初の変化を firstChangeMs まで待ち、変化があれば、それから settleMs 変化が止まるまで待つ。
// 2026-11-19 の計測（docs/design/performance.md）: Dataview は render() の約 100〜125 ms 後に描画を始め、変化はその後 25 ms ほどで終わる。
// 非同期に描くものがないノートでは、DOM はまったく変わらなかった（PDF 47 件中 44 件）。

/** 非同期に描くもの（他のプラグインのコードブロック・ノートの埋め込み・Dataview のインラインクエリ）があるときの、最初の変化を待つ時間。 */
export const FIRST_CHANGE_MS = 500;
/** 非同期に描くものがないときの、最初の変化を待つ時間（念のため少しだけ待つ）。 */
export const STATIC_FIRST_CHANGE_MS = 100;
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
	for (const m of markdown.matchAll(FENCE)) if (renderable(m[1])) return true;
	for (const m of markdown.matchAll(NOTE_EMBED)) if (!ATTACHMENT_EXT.test(m[1].trim())) return true;
	return INLINE_QUERY.test(markdown);
}

/** ノート全体を描くときの待ち方。 */
export function noteTiming(markdown: string, renderable: (lang: string) => boolean): QuietTiming {
	return { firstChangeMs: mayRenderLater(markdown, renderable) ? FIRST_CHANGE_MS : STATIC_FIRST_CHANGE_MS, settleMs: SETTLE_MS };
}
