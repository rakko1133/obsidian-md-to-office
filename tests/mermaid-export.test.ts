import { describe, expect, it } from "vitest";
import { exportMermaidNote, planMermaidNote, type MermaidExportDeps } from "../src/core/mermaid-export";
import { refKey } from "../src/core/output-plan";
import { readPngDpi } from "../src/core/png";
import { DEFAULT_SETTINGS, type PluginSettings } from "../src/core/settings";
import type { ManifestSnapshot, OutputRef } from "../src/core/types";

const PNG_1x1 = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"),
	(ch) => ch.charCodeAt(0),
);

const NOTE = "# t\n```mermaid\nflowchart TD\n  A-->B\n```\n\n```mermaid\npie\n  \"a\" : 1\n```\n";

/** メモリ上の偽の部品。描画回数・書き込み・削除を記録する。 */
function fakeDeps(options: { pngFails?: boolean; renderFailsOn?: string; files?: Map<string, Uint8Array> } = {}) {
	const files = options.files ?? new Map<string, Uint8Array>();
	const cache = new Map<string, Uint8Array>();
	const log = { renders: 0, removed: [] as string[] };
	const deps: MermaidExportDeps = {
		readNote: async () => NOTE,
		renderer: {
			version: "11.0.0",
			render: async (source, _params, needPng) => {
				log.renders++;
				if (options.renderFailsOn && source.includes(options.renderFailsOn)) throw new Error("parse error");
				return { svg: "<svg/>", png: needPng && !options.pngFails ? PNG_1x1 : null, pngError: options.pngFails ? "SecurityError" : undefined };
			},
		},
		cache: {
			get: async (hash, ext) => cache.get(`${hash}.${ext}`) ?? null,
			put: async (hash, ext, bytes) => void cache.set(`${hash}.${ext}`, bytes),
		},
		writer: {
			exists: async (ref) => files.has(refKey(ref)),
			write: async (ref, bytes) => {
				files.set(refKey(ref), bytes);
				return { status: "success", contentHash: `hash-of-${ref.path}` };
			},
			hashOf: async (ref) => (files.has(refKey(ref)) ? `hash-of-${ref.path}` : null),
			remove: async (ref: OutputRef) => {
				log.removed.push(ref.path);
				return files.delete(refKey(ref));
			},
		},
	};
	return { deps, files, cache, log };
}

const settings: PluginSettings = { ...DEFAULT_SETTINGS };
const empty: ManifestSnapshot = { entries: [] };
const signal = () => new AbortController().signal;

describe("exportMermaidNote", () => {
	it("図ごとに PNG を描画して、ミラー出力のフォルダに命名規則どおり保存する。PNG には DPI を書き込む", async () => {
		const { deps, files } = fakeDeps();
		const r = await exportMermaidNote("docs/設計.md", signal(), settings, empty, deps);
		expect(r.status).toBe("success");
		expect(r.files.map((f) => f.output.path)).toEqual([
			expect.stringMatching(/^_export\/docs\/設計_mermaid_01_[0-9a-f]{8}\.png$/),
			expect.stringMatching(/^_export\/docs\/設計_mermaid_02_[0-9a-f]{8}\.png$/),
		]);
		const written = files.get(refKey(r.files[0]!.output))!;
		expect(readPngDpi(written)).toBe(192);
	});

	it("2 回目は変更なしになり、描画しない", async () => {
		const { deps, log } = fakeDeps();
		await exportMermaidNote("a.md", signal(), settings, empty, deps);
		const before = log.renders;
		const r = await exportMermaidNote("a.md", signal(), settings, empty, deps);
		expect(log.renders).toBe(before);
		expect(r.files.every((f) => f.status === "unchanged")).toBe(true);
	});

	it("出力ファイルがなくても、キャッシュがあれば描画しない", async () => {
		const { deps, files, log } = fakeDeps();
		await exportMermaidNote("a.md", signal(), settings, empty, deps);
		files.clear();
		const before = log.renders;
		const r = await exportMermaidNote("a.md", signal(), settings, empty, deps);
		expect(log.renders).toBe(before);
		expect(r.files.every((f) => f.status === "success")).toBe(true);
	});

	it("新しい画像を書き終えたら、マニフェストにある同じ連番の古い画像を消す", async () => {
		const { deps, files, log } = fakeDeps();
		files.set("vault:_export/a_mermaid_01_deadbeef.png", PNG_1x1);
		const manifest: ManifestSnapshot = {
			entries: [{ output: { location: "vault", path: "_export/a_mermaid_01_deadbeef.png" }, sources: ["a.md"], kind: "image", diagramIndex: 1, contentHash: "x", writtenAt: "t" }],
		};
		const r = await exportMermaidNote("a.md", signal(), settings, manifest, deps);
		expect(log.removed).toEqual(["_export/a_mermaid_01_deadbeef.png"]);
		expect(r.deleted).toEqual([{ location: "vault", path: "_export/a_mermaid_01_deadbeef.png" }]);
	});

	it("PNG 化に失敗したら SVG だけを保存して警告する", async () => {
		const { deps } = fakeDeps({ pngFails: true });
		const r = await exportMermaidNote("a.md", signal(), settings, empty, deps);
		expect(r.files.every((f) => f.output.path.endsWith(".svg") && f.status === "success")).toBe(true);
		expect(r.warnings.filter((w) => w.code === "pngFailedSvgOnly")).toHaveLength(2);
	});

	it("描画に失敗した図は失敗として記録し、ほかの図は保存する", async () => {
		const { deps } = fakeDeps({ renderFailsOn: "pie" });
		const r = await exportMermaidNote("a.md", signal(), settings, empty, deps);
		expect(r.status).toBe("failed");
		expect(r.files.map((f) => f.status)).toEqual(["success", "failed"]);
		expect(r.warnings.map((w) => w.code)).toContain("mermaidRenderFailed");
	});

	it("図がないノートはスキップ", async () => {
		const { deps } = fakeDeps();
		deps.readNote = async () => "# no diagrams";
		const r = await exportMermaidNote("a.md", signal(), settings, empty, deps);
		expect(r).toMatchObject({ status: "skipped", reason: "noDiagrams" });
	});

	it("タイムアウトで abort されていたら書き込まずに例外を投げる", async () => {
		const { deps, files } = fakeDeps();
		const controller = new AbortController();
		controller.abort(new Error("timeout"));
		await expect(exportMermaidNote("a.md", controller.signal, settings, empty, deps)).rejects.toThrow("timeout");
		expect(files.size).toBe(0);
	});
});

describe("planMermaidNote", () => {
	it("描画せずに出力パスと予定動作を出す", async () => {
		const existing = new Set<string>();
		const plans = await planMermaidNote("a.md", NOTE, { ...settings, mermaidImageFormat: "both" }, "11.0.0", async (ref) => existing.has(refKey(ref)));
		expect(plans).toHaveLength(4);
		expect(plans.every((p) => p.action === "create")).toBe(true);
		existing.add(refKey(plans[0]!.output));
		const again = await planMermaidNote("a.md", NOTE, { ...settings, mermaidImageFormat: "both" }, "11.0.0", async (ref) => existing.has(refKey(ref)));
		expect(again[0]!.action).toBe("unchanged");
	});

	it("ドライランと実行で同じ出力パスになる", async () => {
		const { deps } = fakeDeps();
		const plans = await planMermaidNote("a.md", NOTE, settings, deps.renderer.version, async () => false);
		const r = await exportMermaidNote("a.md", signal(), settings, empty, deps);
		expect(r.files.map((f) => f.output)).toEqual(plans.map((p) => p.output));
	});
});
