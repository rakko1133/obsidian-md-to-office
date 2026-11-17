// 動作確認用の最小の .docx / .xlsx を作る。Obsidian API に依存しない（G2・G4）。
// フェーズ 0 の完了条件 B4（docx と exceljs が Obsidian の中で動くか）の確認に使う。
import { Document, Packer, Paragraph } from "docx";
import { Workbook } from "exceljs";

export const SAMPLE_TEXT = "Batch Office Export: sample";

export async function buildSampleDocx(): Promise<ArrayBuffer> {
	const doc = new Document({
		sections: [{ children: [new Paragraph(SAMPLE_TEXT)] }],
	});
	return Packer.toArrayBuffer(doc);
}

export async function buildSampleXlsx(): Promise<ArrayBuffer> {
	const workbook = new Workbook();
	const sheet = workbook.addWorksheet("Sheet1");
	sheet.getCell("A1").value = SAMPLE_TEXT;
	const data: unknown = await workbook.xlsx.writeBuffer();
	return toArrayBuffer(data);
}

/** exceljs の writeBuffer は実行環境によって Buffer / Uint8Array / ArrayBuffer を返すので、ArrayBuffer にそろえる。 */
function toArrayBuffer(data: unknown): ArrayBuffer {
	if (data instanceof ArrayBuffer) return data;
	if (ArrayBuffer.isView(data)) {
		const copy = new Uint8Array(data.byteLength);
		copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		return copy.buffer;
	}
	throw new TypeError("exceljs returned an unexpected buffer type");
}
