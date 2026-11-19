// Mermaid 画像の専用キャッシュ（フェーズ 1 の決定事項）。プラグインのデータフォルダの cache/mermaid/ に、ハッシュ名で置く。
import { promises as fs } from "fs";
import * as nodePath from "path";
import { CACHE_LIMIT_BYTES, selectEvictions, type CacheFile } from "../core/cache-policy";
import type { DiagramCache } from "../core/mermaid-export";
import { timed } from "../core/profile";

export class FsDiagramCache implements DiagramCache {
	constructor(private readonly dir: string) {}

	private file(hash: string, ext: string): string {
		return nodePath.join(this.dir, `${hash}.${ext}`);
	}

	get(hash: string, ext: "svg" | "png"): Promise<Uint8Array | null> {
		return timed("io/cacheGet", () => this.read(hash, ext));
	}

	private async read(hash: string, ext: "svg" | "png"): Promise<Uint8Array | null> {
		const path = this.file(hash, ext);
		try {
			const bytes = await fs.readFile(path);
			// 最後に使った時刻として更新日時を進める（古いものから消すため）
			const now = new Date();
			await fs.utimes(path, now, now).catch(() => undefined);
			return new Uint8Array(bytes);
		} catch {
			return null;
		}
	}

	async put(hash: string, ext: "svg" | "png", bytes: Uint8Array): Promise<void> {
		await fs.mkdir(this.dir, { recursive: true });
		await fs.writeFile(this.file(hash, ext), bytes);
	}

	/** 上限（100 MB）を超えていれば古いものから消す。実行の最後に呼ぶ。 */
	async evict(limitBytes = CACHE_LIMIT_BYTES): Promise<void> {
		let names: string[];
		try {
			names = await fs.readdir(this.dir);
		} catch {
			return;
		}
		const files: CacheFile[] = [];
		for (const name of names) {
			const stat = await fs.stat(nodePath.join(this.dir, name)).catch(() => null);
			if (stat?.isFile()) files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
		}
		for (const name of selectEvictions(files, limitBytes)) {
			await fs.rm(nodePath.join(this.dir, name), { force: true }).catch(() => undefined);
		}
	}
}
