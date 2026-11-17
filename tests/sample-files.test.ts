import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SAMPLE_TEXT, buildSampleDocx, buildSampleXlsx } from "../src/core/sample-files";

// .docx / .xlsx は ZIP 形式。展開して、本文の XML に文字列が入っていることを確かめる。
describe("サンプルファイルの生成", () => {
	it(".docx を生成できる", async () => {
		const zip = await JSZip.loadAsync(await buildSampleDocx());
		const xml = await zip.file("word/document.xml")?.async("string");
		expect(xml).toContain(SAMPLE_TEXT);
	});

	it(".xlsx を生成できる", async () => {
		const zip = await JSZip.loadAsync(await buildSampleXlsx());
		expect(zip.file("xl/workbook.xml")).not.toBeNull();
		const strings = await zip.file("xl/sharedStrings.xml")?.async("string");
		expect(strings).toContain(SAMPLE_TEXT);
	});
});
