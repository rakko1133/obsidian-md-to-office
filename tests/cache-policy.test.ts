import { describe, expect, it } from "vitest";
import { selectEvictions } from "../src/core/cache-policy";

describe("selectEvictions", () => {
	it("上限以下なら何も消さない", () => {
		expect(selectEvictions([{ name: "a", size: 10, mtimeMs: 1 }], 10)).toEqual([]);
	});

	it("上限を超えたら古いものから消す", () => {
		const files = [
			{ name: "new", size: 40, mtimeMs: 3 },
			{ name: "old", size: 40, mtimeMs: 1 },
			{ name: "mid", size: 40, mtimeMs: 2 },
		];
		expect(selectEvictions(files, 50)).toEqual(["old", "mid"]);
	});
});
