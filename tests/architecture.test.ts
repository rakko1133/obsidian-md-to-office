import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// C2: Obsidian に依存しない中核（src/core）と UI 文字列（src/i18n）が、obsidian を import していないことを確かめる（G2・G4）。
const OBSIDIAN_FREE_DIRS = ["src/core", "src/i18n"];
const IMPORT_OBSIDIAN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']obsidian["']/;

function listTsFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? listTsFiles(path) : path.endsWith(".ts") ? [path] : [];
	});
}

describe("Obsidian に依存しない部分", () => {
	for (const dir of OBSIDIAN_FREE_DIRS) {
		it(`${dir} は obsidian を import しない`, () => {
			const offenders = listTsFiles(dir).filter((file) => IMPORT_OBSIDIAN.test(readFileSync(file, "utf8")));
			expect(offenders).toEqual([]);
		});
	}
});
