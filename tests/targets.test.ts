import { describe, expect, it } from "vitest";
import { filterTargets, isExportDisabled } from "../src/core/targets";

const c = (path: string, explicit = false, frontmatterExport?: unknown) => ({ path, explicit, frontmatterExport });

describe("filterTargets", () => {
	it("glob の除外はフォルダ展開で来たノートにだけ効き、直接選んだノートには効かない", () => {
		const r = filterTargets([c("a/x.excalidraw.md"), c("b/y.excalidraw.md", true), c("c/z.md")], [], ["**/*.excalidraw.md"]);
		expect(r.targets).toEqual(["b/y.excalidraw.md", "c/z.md"]);
		expect(r.excluded).toEqual([{ path: "a/x.excalidraw.md", reason: "glob" }]);
	});

	it("export: false は直接選んでも除外する", () => {
		const r = filterTargets([c("p.md", true, false), c("q.md", false, "no")], [], []);
		expect(r.targets).toEqual([]);
		expect(r.excluded.map((e) => e.reason)).toEqual(["frontmatter", "frontmatter"]);
	});

	it("include が空ならすべて含め、指定があれば一致するものだけ", () => {
		expect(filterTargets([c("a/1.md"), c("b/2.md")], [], []).targets).toEqual(["a/1.md", "b/2.md"]);
		expect(filterTargets([c("a/1.md"), c("b/2.md")], ["a/**"], []).targets).toEqual(["a/1.md"]);
	});

	it("ルート直下のノートにも **/ のパターンが効く", () => {
		expect(filterTargets([c("x.excalidraw.md")], [], ["**/*.excalidraw.md"]).targets).toEqual([]);
	});

	it("重複をまとめ、どれかが直接選ばれていれば直接選んだ扱いにする", () => {
		const r = filterTargets([c("t/a.md"), c("t/a.md", true)], [], ["t/**"]);
		expect(r.targets).toEqual(["t/a.md"]);
	});

	it(".md 以外は除外する", () => {
		expect(filterTargets([c("img.png", true)], [], []).excluded).toEqual([{ path: "img.png", reason: "notMarkdown" }]);
	});
});

describe("isExportDisabled", () => {
	it.each([
		[false, true],
		["false", true],
		["No", true],
		[true, false],
		[undefined, false],
		["yes", false],
		[0, false],
	])("%s → %s", (value, expected) => {
		expect(isExportDisabled(value)).toBe(expected);
	});
});
