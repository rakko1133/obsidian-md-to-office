// 変換対象の絞り込み（01: 変換対象の収集・R2）。Obsidian API に依存しない。
import picomatch from "picomatch";

// extglob（+(a|b) など）は使わない。picomatch の extglob に ReDoS の脆弱性（GHSA-fc5q-39xc-vjpf、修正版なし）があるため（1.0.2）
const GLOB_OPTIONS = { dot: true, noextglob: true } as const;
import type { ExcludedTarget, TargetCandidate } from "./types";

export interface FilterResult {
	/** 変換対象（Vault からの相対パス。重複を除き、パスの順に並べる） */
	targets: string[];
	excluded: ExcludedTarget[];
}

/**
 * 候補を include / exclude の glob と frontmatter の `export` で絞り込む。
 * - .md 以外は除外する
 * - frontmatter の `export: false` は常に除外する（直接選んだノートも）
 * - glob は、直接選んだノートには適用しない（フェーズ 1 の決定事項）
 * - 同じパスが複数回来たら 1 つにまとめる。どれか 1 つでも直接選ばれていれば直接選んだ扱い
 */
export function filterTargets(candidates: readonly TargetCandidate[], includeGlobs: readonly string[], excludeGlobs: readonly string[]): FilterResult {
	const isIncluded = includeGlobs.length === 0 ? () => true : picomatch([...includeGlobs], GLOB_OPTIONS);
	const isExcluded = excludeGlobs.length === 0 ? () => false : picomatch([...excludeGlobs], GLOB_OPTIONS);

	const merged = new Map<string, TargetCandidate>();
	for (const c of candidates) {
		const prev = merged.get(c.path);
		merged.set(c.path, prev ? { ...prev, explicit: prev.explicit || c.explicit } : c);
	}

	const targets: string[] = [];
	const excluded: ExcludedTarget[] = [];
	for (const c of [...merged.values()].sort((a, b) => a.path.localeCompare(b.path))) {
		if (!c.path.toLowerCase().endsWith(".md")) {
			excluded.push({ path: c.path, reason: "notMarkdown" });
		} else if (isExportDisabled(c.frontmatterExport)) {
			excluded.push({ path: c.path, reason: "frontmatter" });
		} else if (!c.explicit && (!isIncluded(c.path) || isExcluded(c.path))) {
			excluded.push({ path: c.path, reason: "glob" });
		} else {
			targets.push(c.path);
		}
	}
	return { targets, excluded };
}

/** frontmatter の `export` の値が「除外」を表すか。真偽値 false と文字列 "false" / "no"（大文字小文字を区別しない）。 */
export function isExportDisabled(value: unknown): boolean {
	if (value === false) return true;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		return v === "false" || v === "no";
	}
	return false;
}
