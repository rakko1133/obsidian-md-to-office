// 1 件ずつ順に変換するループ（03・R3・D1・D2・D5）。Obsidian API に依存しない。
import type { FileResult, NoteResult, RunEnd } from "./types";

export interface RunOptions {
	notes: readonly string[];
	/** ノート 1 件を処理する。signal はタイムアウトしたときだけ abort される（D1・D2） */
	processNote: (notePath: string, signal: AbortSignal) => Promise<NoteResult>;
	timeoutMs: number;
	onError: "continue" | "failFast";
	/** 中断ボタンが押されたか。次の 1 件を始める前にだけ確かめる（D1） */
	isCancelled: () => boolean;
	/** 進捗（処理を始める直前に呼ぶ）。done は処理済みの件数 */
	onProgress?: (done: number, total: number, notePath: string) => void;
	/** タイマー。Obsidian では window のもの（ポップアウトのウィンドウ対応）、テストでは Node.js のものを渡す */
	timers: RunTimers;
	/** イベントループに制御を返す（R3: UI を固めない）。既定は timers.set(…, 0) */
	yieldToEventLoop?: () => Promise<void>;
}

export interface RunTimers {
	set: (callback: () => void, ms: number) => unknown;
	clear: (handle: unknown) => void;
}

export interface RunOutcome {
	results: NoteResult[];
	end: RunEnd;
}

export const TIMEOUT_REASON = "timeout";

export async function runSequential(options: RunOptions): Promise<RunOutcome> {
	const { notes, processNote, timeoutMs, onError, isCancelled, onProgress, timers } = options;
	const yieldNow = options.yieldToEventLoop ?? (() => new Promise<void>((resolve) => timers.set(resolve, 0)));
	const results: NoteResult[] = [];

	for (let i = 0; i < notes.length; i++) {
		if (isCancelled()) return { results, end: "cancelled" };
		const notePath = notes[i];
		onProgress?.(i, notes.length, notePath);
		await yieldNow();

		const result = await processWithTimeout(notePath, processNote, timeoutMs, timers);
		results.push(result);
		if (result.status === "failed" && onError === "failFast") return { results, end: "failFast" };
	}
	return { results, end: "completed" };
}

async function processWithTimeout(
	notePath: string,
	processNote: RunOptions["processNote"],
	timeoutMs: number,
	timers: RunTimers,
): Promise<NoteResult> {
	const controller = new AbortController();
	let timer: unknown;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = timers.set(() => {
			controller.abort(new Error(TIMEOUT_REASON));
			resolve("timeout");
		}, timeoutMs);
	});
	try {
		const work = processNote(notePath, controller.signal).catch((error: unknown) => failedResult(notePath, errorMessage(error)));
		const winner = await Promise.race([work, timeout]);
		// タイムアウトした後に遅れて返った結果は捨てる（R3）
		return winner === "timeout" ? failedResult(notePath, TIMEOUT_REASON) : winner;
	} finally {
		timers.clear(timer);
	}
}

export function failedResult(notePath: string, reason: string): NoteResult {
	return { notePath, status: "failed", files: [], warnings: [], reason, deleted: [] };
}

/** ノートの状態を、出力ファイルの状態のうちいちばん重いものにする（失敗 > スキップ > 成功: D5）。 */
export function aggregateStatus(files: readonly FileResult[]): NoteResult["status"] {
	if (files.some((f) => f.status === "failed")) return "failed";
	if (files.length === 0 || files.every((f) => f.status === "skipped")) return "skipped";
	if (files.some((f) => f.status === "skipped")) return "skipped";
	return "success";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 「両方」のノートの結果をまとめる（失敗 > スキップ > 成功: D5）。同じ警告（2 回組み立てるので重なる）は 1 つにする。 */
/** 3 つ以上の形式の結果をまとめる（Word・Excel・PDF: H1-PDF）。先頭の結果を基準にする。 */
export function mergeAllResults(results: readonly NoteResult[]): NoteResult {
	return results.slice(1).reduce((merged, next) => mergeResults(merged, next), results[0]);
}

export function mergeResults(docx: NoteResult, xlsx: NoteResult): NoteResult {
	const files = [...docx.files, ...xlsx.files];
	const seen = new Set<string>();
	const warnings = [...docx.warnings, ...xlsx.warnings].filter((w) => {
		const key = `${w.code}:${w.detail ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const failed = [docx, xlsx].find((r) => r.status === "failed");
	const status = failed ? "failed" : files.length > 0 ? aggregateStatus(files) : docx.status;
	const reason = failed?.reason ?? (status === "skipped" ? docx.reason : undefined);
	return { notePath: docx.notePath, status, files, warnings, deleted: [...docx.deleted, ...xlsx.deleted], ...(reason ? { reason } : {}) };
}
