import { describe, expect, it } from "vitest";
import { findOldImages, isProtectedPath, noteBaseName, outputDirFor, plannedAction, renamedPath } from "../src/core/output-plan";
import type { ManifestEntry } from "../src/core/types";

const base = { saveMode: "mirror" as const, outputLocation: "vault" as const, outputRoot: "_export" };

describe("outputDirFor", () => {
	it("ミラー出力では出力ルートの下に同じフォルダ構成を作る", () => {
		expect(outputDirFor("notes/sub/a.md", base)).toEqual({ location: "vault", path: "_export/notes/sub" });
		expect(outputDirFor("a.md", base)).toEqual({ location: "vault", path: "_export" });
	});

	it("同一フォルダでは元ノートと同じフォルダ", () => {
		expect(outputDirFor("notes/a.md", { ...base, saveMode: "sameFolder" })).toEqual({ location: "vault", path: "notes" });
	});

	it("Vault 外では出力ルートからの相対パス", () => {
		expect(outputDirFor("notes/a.md", { ...base, outputLocation: "external" })).toEqual({ location: "external", path: "notes" });
	});
});

describe("plannedAction", () => {
	it("ないなら新規、ハッシュ入りの名前なら変更なし、それ以外は設定に従う", () => {
		expect(plannedAction(false, false, "skip")).toBe("create");
		expect(plannedAction(true, true, "overwrite")).toBe("unchanged");
		expect(plannedAction(true, false, "overwrite")).toBe("overwrite");
		expect(plannedAction(true, false, "skip")).toBe("skip");
		expect(plannedAction(true, false, "rename")).toBe("rename");
	});
});

describe("renamedPath", () => {
	it("空いている最初の連番を使う", () => {
		const taken = new Set(["out/a (1).docx"]);
		expect(renamedPath("out/a.docx", (p) => taken.has(p))).toBe("out/a (2).docx");
	});
});

describe("isProtectedPath", () => {
	it(".md・.canvas と変換元には書き込まない", () => {
		const sources = new Set(["n/a.md", "n/img.png"]);
		expect(isProtectedPath({ location: "vault", path: "_export/a.md" }, sources)).toBe(true);
		expect(isProtectedPath({ location: "vault", path: "x.canvas" }, sources)).toBe(true);
		expect(isProtectedPath({ location: "vault", path: "n/img.png" }, sources)).toBe(true);
		expect(isProtectedPath({ location: "vault", path: "_export/n/a_mermaid_01_x.png" }, sources)).toBe(false);
	});
});

describe("noteBaseName", () => {
	it("フォルダと拡張子を除く", () => {
		expect(noteBaseName("a/b/ノート.md")).toBe("ノート");
	});
});

describe("findOldImages", () => {
	const entry = (path: string, diagramIndex: number, source = "n/a.md"): ManifestEntry => ({
		output: { location: "vault", path },
		sources: [source],
		kind: "image",
		diagramIndex,
		contentHash: "h",
		writtenAt: "t",
	});

	it("同じノート・同じ連番で、今回の出力にない画像だけを返す", () => {
		const manifest = { entries: [entry("old1.png", 1), entry("new1.png", 1), entry("old2.png", 2), entry("other.png", 1, "n/b.md")] };
		expect(findOldImages(manifest, "n/a.md", 1, [{ location: "vault", path: "new1.png" }])).toEqual([{ location: "vault", path: "old1.png" }]);
	});
});
