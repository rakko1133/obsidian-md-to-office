// 処理時間の計測（開発用: 高速化の検討）。計測を始めていないときは、包んだ処理をそのまま呼ぶだけにする。
// ラベルは「段/細かい段」のように / で階層を表す（例: docx/assemble/parse）。同じラベルは回数・合計・最大を集計する。
// 入れ子の計測の時間は親の時間にも含まれる（包含時間: inclusive time）。
// 使い方は docs/process/development.md の「処理時間の計測」。

export interface ProfileEntry {
	label: string;
	count: number;
	totalMs: number;
	maxMs: number;
}

export class Profiler {
	private readonly entries = new Map<string, ProfileEntry>();
	private readonly startedAt: number;

	constructor(private readonly now: () => number = () => performance.now()) {
		this.startedAt = now();
	}

	record(label: string, ms: number): void {
		const entry = this.entries.get(label);
		if (entry) {
			entry.count++;
			entry.totalMs += ms;
			entry.maxMs = Math.max(entry.maxMs, ms);
		} else {
			this.entries.set(label, { label, count: 1, totalMs: ms, maxMs: ms });
		}
	}

	clock(): number {
		return this.now();
	}

	/** 計測開始からの経過時間と、ラベル順に並べた集計。 */
	report(): { wallMs: number; entries: ProfileEntry[] } {
		const entries = [...this.entries.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
		return { wallMs: this.now() - this.startedAt, entries: entries.map((e) => ({ ...e })) };
	}
}

let active: Profiler | null = null;

/** 計測を始める（実行ごとに 1 つ）。 */
export function startProfiling(now?: () => number): Profiler {
	active = new Profiler(now);
	return active;
}

/** 計測を終える。以後の timed は何もしない。 */
export function stopProfiling(): void {
	active = null;
}

/** 計測した時間をそのまま記録する（包めない処理の内訳: 描画の静止待ちで最後に DOM が変わった時刻など）。 */
export function recordProfile(label: string, ms: number): void {
	active?.record(label, ms);
}

/** 計測中の時計（計測していなければ null）。 */
export function profileClock(): number | null {
	return active ? active.clock() : null;
}

/** 非同期の処理を計測する。失敗しても時間は記録する。 */
export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
	const profiler = active;
	if (!profiler) return fn();
	const start = profiler.clock();
	try {
		return await fn();
	} finally {
		profiler.record(label, profiler.clock() - start);
	}
}

/** 同期の処理を計測する。 */
export function timedSync<T>(label: string, fn: () => T): T {
	const profiler = active;
	if (!profiler) return fn();
	const start = profiler.clock();
	try {
		return fn();
	} finally {
		profiler.record(label, profiler.clock() - start);
	}
}

