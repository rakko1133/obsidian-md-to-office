import { describe, expect, it } from "vitest";
import { readPngDpi, setPngDpi } from "../src/core/png";

// 1x1 の白い PNG（IHDR・IDAT・IEND だけ）
const PNG_1x1 = Uint8Array.from(
	atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"),
	(ch) => ch.charCodeAt(0),
);

function chunkTypes(png: Uint8Array): string[] {
	const types: string[] = [];
	let offset = 8;
	while (offset < png.length) {
		const len = (png[offset]! << 24) | (png[offset + 1]! << 16) | (png[offset + 2]! << 8) | png[offset + 3]!;
		types.push(String.fromCharCode(...png.subarray(offset + 4, offset + 8)));
		offset += 12 + len;
	}
	return types;
}

describe("setPngDpi", () => {
	it("IHDR の直後に pHYs を入れ、DPI を読み戻せる", () => {
		const out = setPngDpi(PNG_1x1, 192);
		expect(chunkTypes(out)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
		expect(readPngDpi(out)).toBe(192);
	});

	it("既にある pHYs は置き換える（2 つにならない）", () => {
		const out = setPngDpi(setPngDpi(PNG_1x1, 96), 300);
		expect(chunkTypes(out).filter((t) => t === "pHYs")).toHaveLength(1);
		expect(readPngDpi(out)).toBe(300);
	});

	it("PNG でなければ例外", () => {
		expect(() => setPngDpi(new Uint8Array([1, 2, 3]), 96)).toThrow();
	});
});
