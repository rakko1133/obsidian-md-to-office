// PNG に解像度（pHYs チャンク）を書き込む（R4: Word で開いたときの実寸を合わせる）。Obsidian API に依存しない。

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG のバイト列に、DPI を表す pHYs チャンクを書き込んだ新しいバイト列を返す。
 * 既に pHYs があれば置き換え、なければ IHDR の直後に入れる。
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
	if (!PNG_SIGNATURE.every((b, i) => png[i] === b)) throw new Error("not a PNG");
	const pixelsPerMeter = Math.round(dpi / 0.0254);
	const phys = makeChunk("pHYs", [...u32(pixelsPerMeter), ...u32(pixelsPerMeter), 1]);

	const parts: Uint8Array[] = [png.subarray(0, 8)];
	let offset = 8;
	let inserted = false;
	while (offset < png.length) {
		const length = readU32(png, offset);
		const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
		const end = offset + 12 + length;
		if (type !== "pHYs") parts.push(png.subarray(offset, end));
		if (type === "IHDR" && !inserted) {
			parts.push(phys);
			inserted = true;
		}
		offset = end;
	}
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let pos = 0;
	for (const p of parts) {
		out.set(p, pos);
		pos += p.length;
	}
	return out;
}

/** PNG の pHYs から DPI を読む（テスト用）。なければ null。 */
export function readPngDpi(png: Uint8Array): number | null {
	let offset = 8;
	while (offset < png.length) {
		const length = readU32(png, offset);
		const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
		if (type === "pHYs") return Math.round(readU32(png, offset + 8) * 0.0254);
		offset += 12 + length;
	}
	return null;
}

function makeChunk(type: string, data: number[]): Uint8Array {
	const typeBytes = [...type].map((c) => c.charCodeAt(0));
	const body = new Uint8Array([...typeBytes, ...data]);
	return new Uint8Array([...u32(data.length), ...body, ...u32(crc32(body))]);
}

function u32(n: number): number[] {
	return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function readU32(bytes: Uint8Array, offset: number): number {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * PNG の data URL（`data:image/png;base64,...`: canvas.toDataURL の戻り値）をバイト列にする。
 * PNG の data URL でなければ例外（canvas が PNG に対応していないときは image/png 以外が返る）。
 */
export function pngDataUrlToBytes(dataUrl: string): Uint8Array {
	const prefix = "data:image/png;base64,";
	if (!dataUrl.startsWith(prefix)) throw new Error(`not a PNG data URL: ${dataUrl.slice(0, 32)}`);
	const binary = atob(dataUrl.slice(prefix.length));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
