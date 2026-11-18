// Mermaid 画像の専用キャッシュの上限管理（フェーズ 1 の決定事項: 上限 100 MB、古いものから消す）。
// Obsidian API に依存しない。

export const CACHE_LIMIT_BYTES = 100 * 1024 * 1024;

export interface CacheFile {
	name: string;
	size: number;
	/** 最後に使った時刻（ファイルの更新日時）。ミリ秒 */
	mtimeMs: number;
}

/** 合計が上限を超えていれば、古いものから消すファイルの名前を返す。 */
export function selectEvictions(files: readonly CacheFile[], limitBytes: number): string[] {
	let total = files.reduce((n, f) => n + f.size, 0);
	const evict: string[] = [];
	for (const f of [...files].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
		if (total <= limitBytes) break;
		evict.push(f.name);
		total -= f.size;
	}
	return evict;
}
