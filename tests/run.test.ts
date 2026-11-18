import { describe, expect, it } from "vitest";
import { aggregateStatus, mergeResults, runSequential, TIMEOUT_REASON } from "../src/core/run";
import type { FileResult, NoteResult } from "../src/core/types";

// C2: タイムアウト・continue-on-error・fail-fast・中断を、偽の部品で確かめる
const ok = (notePath: string): NoteResult => ({ notePath, status: "success", files: [], warnings: [], deleted: [] });
const failed = (notePath: string): NoteResult => ({ notePath, status: "failed", files: [], warnings: [], deleted: [], reason: "x" });
const noYield = () => Promise.resolve();

describe("runSequential", () => {
	it("すべて順に処理し、進捗を通知する", async () => {
		const progress: string[] = [];
		const out = await runSequential({
			notes: ["a.md", "b.md"],
			processNote: async (p) => ok(p),
			timeoutMs: 1000,
			onError: "continue",
			isCancelled: () => false,
			onProgress: (done, total, p) => progress.push(`${done}/${total} ${p}`),
			yieldToEventLoop: noYield,
		});
		expect(out.end).toBe("completed");
		expect(out.results.map((r) => r.notePath)).toEqual(["a.md", "b.md"]);
		expect(progress).toEqual(["0/2 a.md", "1/2 b.md"]);
	});

	it("continue-on-error では失敗しても次へ進む", async () => {
		const out = await runSequential({
			notes: ["a.md", "b.md", "c.md"],
			processNote: async (p) => (p === "b.md" ? failed(p) : ok(p)),
			timeoutMs: 1000,
			onError: "continue",
			isCancelled: () => false,
			yieldToEventLoop: noYield,
		});
		expect(out.end).toBe("completed");
		expect(out.results.map((r) => r.status)).toEqual(["success", "failed", "success"]);
	});

	it("fail-fast では最初の失敗で止まる", async () => {
		const out = await runSequential({
			notes: ["a.md", "b.md", "c.md"],
			processNote: async (p) => (p === "b.md" ? failed(p) : ok(p)),
			timeoutMs: 1000,
			onError: "failFast",
			isCancelled: () => false,
			yieldToEventLoop: noYield,
		});
		expect(out.end).toBe("failFast");
		expect(out.results).toHaveLength(2);
	});

	it("例外は失敗として記録する", async () => {
		const out = await runSequential({
			notes: ["a.md"],
			processNote: async () => {
				throw new Error("boom");
			},
			timeoutMs: 1000,
			onError: "continue",
			isCancelled: () => false,
			yieldToEventLoop: noYield,
		});
		expect(out.results[0]).toMatchObject({ status: "failed", reason: "boom" });
	});

	it("タイムアウトしたら signal を abort し、失敗として次へ進む。遅れて返った結果は捨てる", async () => {
		let aborted = false;
		const out = await runSequential({
			notes: ["slow.md", "b.md"],
			processNote: (p, signal) =>
				p === "slow.md"
					? new Promise((resolve) => {
							signal.addEventListener("abort", () => {
								aborted = true;
								setTimeout(() => resolve(ok(p)), 5);
							});
						})
					: Promise.resolve(ok(p)),
			timeoutMs: 20,
			onError: "continue",
			isCancelled: () => false,
			yieldToEventLoop: noYield,
		});
		expect(aborted).toBe(true);
		expect(out.results[0]).toMatchObject({ notePath: "slow.md", status: "failed", reason: TIMEOUT_REASON });
		expect(out.results[1]!.status).toBe("success");
	});

	it("中断は処理中の 1 件を終えてから止める（signal は abort しない）", async () => {
		let cancelled = false;
		let sawAbort = false;
		const out = await runSequential({
			notes: ["a.md", "b.md", "c.md"],
			processNote: async (p, signal) => {
				if (p === "a.md") cancelled = true; // 処理中に中断ボタンが押された
				await new Promise((r) => setTimeout(r, 5));
				sawAbort ||= signal.aborted;
				return ok(p);
			},
			timeoutMs: 1000,
			onError: "continue",
			isCancelled: () => cancelled,
			yieldToEventLoop: noYield,
		});
		expect(out.end).toBe("cancelled");
		expect(out.results.map((r) => r.notePath)).toEqual(["a.md"]);
		expect(sawAbort).toBe(false);
	});
});

describe("aggregateStatus", () => {
	const f = (status: FileResult["status"]): FileResult => ({ output: { location: "vault", path: "x" }, kind: "image", status });

	it("失敗 > スキップ > 成功。変更なしは成功に数える", () => {
		expect(aggregateStatus([f("success"), f("failed"), f("skipped")])).toBe("failed");
		expect(aggregateStatus([f("success"), f("skipped")])).toBe("skipped");
		expect(aggregateStatus([f("success"), f("unchanged")])).toBe("success");
		expect(aggregateStatus([])).toBe("skipped");
	});
});

describe("「両方」の結果のまとめ（R8・D5）", () => {
	const file = (path: string, status: "success" | "skipped" | "failed", kind: "docx" | "xlsx" = "docx") => ({ output: { location: "vault" as const, path }, kind, status });
	const note = (status: NoteResult["status"], files: NoteResult["files"], extra: Partial<NoteResult> = {}): NoteResult => ({ notePath: "a.md", status, files, warnings: [], deleted: [], ...extra });

	it("両方の出力を足し、重いほうの状態にする", () => {
		expect(mergeResults(note("success", [file("a.docx", "success")]), note("success", [file("a.xlsx", "success", "xlsx")]))).toMatchObject({ status: "success", files: [{ output: { path: "a.docx" } }, { output: { path: "a.xlsx" } }] });
		expect(mergeResults(note("success", [file("a.docx", "success")]), note("skipped", [file("a.xlsx", "skipped", "xlsx")]))).toMatchObject({ status: "skipped" });
		expect(mergeResults(note("success", [file("a.docx", "success")]), note("failed", [], { reason: "boom" }))).toMatchObject({ status: "failed", reason: "boom" });
	});

	it("表がない（Excel だけのスキップ）は、ノートのスキップにしない", () => {
		expect(mergeResults(note("success", [file("a.docx", "success")]), note("skipped", [], { reason: "noTables" }))).toMatchObject({ status: "success", files: [{ output: { path: "a.docx" } }] });
	});

	it("1 フォルダ = 1 ブックの途中（Excel の出力がまだない）は Word の状態", () => {
		expect(mergeResults(note("success", [file("a.docx", "success")]), note("success", []))).toMatchObject({ status: "success" });
	});

	it("同じ警告は 1 つにする", () => {
		const w = { code: "brokenLink" as const, detail: "x" };
		expect(mergeResults(note("success", [], { warnings: [w] }), note("success", [], { warnings: [w, { code: "cellTruncated" }] })).warnings).toEqual([w, { code: "cellTruncated" }]);
	});
});
