import { afterEach, describe, expect, it } from "vitest";
import { startProfiling, stopProfiling, timed, timedSync } from "../src/core/profile";

/** 呼ぶたびに決まった量だけ進む時計。 */
function fakeClock(steps: number[]): () => number {
	let t = 0;
	let i = 0;
	return () => {
		const now = t;
		t += steps[i++ % steps.length];
		return now;
	};
}

describe("処理時間の計測", () => {
	afterEach(() => stopProfiling());

	it("計測していないときは、包んだ処理の結果をそのまま返す", async () => {
		expect(await timed("a", async () => 1)).toBe(1);
		expect(timedSync("b", () => 2)).toBe(2);
	});

	it("同じラベルの回数・合計・最大を集計する", async () => {
		const profiler = startProfiling(fakeClock([0, 10, 0, 30]));
		await timed("docx/render", async () => undefined);
		await timed("docx/render", async () => undefined);
		timedSync("assemble/links", () => undefined);
		const entries = profiler.report().entries;
		expect(entries.map((e) => e.label)).toEqual(["assemble/links", "docx/render"]);
		const render = entries.find((e) => e.label === "docx/render")!;
		expect(render.count).toBe(2);
		expect(render.maxMs).toBeGreaterThanOrEqual(render.totalMs / 2);
	});

	it("失敗した処理も時間を記録し、例外はそのまま投げる", async () => {
		const profiler = startProfiling();
		await expect(timed("io/write", () => Promise.reject(new Error("x")))).rejects.toThrow("x");
		expect(profiler.report().entries[0]).toMatchObject({ label: "io/write", count: 1 });
	});

	it("計測を終えた後は記録しない", async () => {
		const profiler = startProfiling();
		stopProfiling();
		await timed("a", async () => undefined);
		expect(profiler.report().entries).toEqual([]);
	});
});
