// SHA-256 のハッシュ。Web Crypto（Electron と Node.js の両方にある）を使う。Obsidian API に依存しない。

/** 文字列（UTF-8）またはバイト列の SHA-256 を 16 進の文字列で返す。 */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
	const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
