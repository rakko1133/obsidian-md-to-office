import { describe, expect, it } from "vitest";
import { applyResults, parseManifest, serializeManifest } from "../src/core/manifest";
import type { ManifestEntry, NoteResult } from "../src/core/types";

const entry = (path: string, extra: Partial<ManifestEntry> = {}): ManifestEntry => ({
	output: { location: "vault", path },
	sources: ["n/a.md"],
	kind: "image",
	diagramIndex: 1,
	contentHash: "old",
	writtenAt: "2026-01-01T00:00:00.000Z",
	...extra,
});

describe("parseManifest", () => {
	it("ファイルがなければ空で、壊れていない扱い", () => {
		expect(parseManifest(null)).toEqual({ snapshot: { entries: [] }, broken: false });
	});

	it("JSON として読めなければ空で、壊れている扱い", () => {
		expect(parseManifest("{oops")).toEqual({ snapshot: { entries: [] }, broken: true });
	});

	it("書き出したものを読み戻せる", () => {
		const snapshot = { entries: [entry("x.png")] };
		expect(parseManifest(serializeManifest(snapshot))).toEqual({ snapshot, broken: false });
	});

	it("形の違う記録は捨てて、壊れている扱いにする", () => {
		const text = JSON.stringify({ version: 1, entries: [entry("ok.png"), { output: "bad" }] });
		const parsed = parseManifest(text);
		expect(parsed.broken).toBe(true);
		expect(parsed.snapshot.entries).toHaveLength(1);
	});
});

describe("applyResults", () => {
	const now = "2026-11-18T00:00:00.000Z";

	it("書き込んだ出力を記録し、削除した古い画像を消し、スキップ・失敗は既存の記録を残す", () => {
		const snapshot = { entries: [entry("old.png"), entry("kept.png", { diagramIndex: 2 })] };
		const result: NoteResult = {
			notePath: "n/a.md",
			status: "failed",
			warnings: [],
			deleted: [{ location: "vault", path: "old.png" }],
			files: [
				{ output: { location: "vault", path: "new.png" }, kind: "image", status: "success", contentHash: "h1", diagramIndex: 1 },
				{ output: { location: "vault", path: "kept.png" }, kind: "image", status: "failed", diagramIndex: 2 },
			],
		};
		const out = applyResults(snapshot, [result], now);
		expect(out.entries.map((e) => e.output.path)).toEqual(["kept.png", "new.png"]);
		expect(out.entries.find((e) => e.output.path === "kept.png")!.contentHash).toBe("old");
		expect(out.entries.find((e) => e.output.path === "new.png")).toMatchObject({ contentHash: "h1", writtenAt: now, sources: ["n/a.md"] });
	});

	it("変更なしで内容も同じなら、記録の日時を変えない", () => {
		const snapshot = { entries: [entry("same.png", { contentHash: "h" })] };
		const result: NoteResult = {
			notePath: "n/a.md",
			status: "success",
			warnings: [],
			deleted: [],
			files: [{ output: { location: "vault", path: "same.png" }, kind: "image", status: "unchanged", contentHash: "h", diagramIndex: 1 }],
		};
		expect(applyResults(snapshot, [result], now).entries[0]!.writtenAt).toBe("2026-01-01T00:00:00.000Z");
	});
});
