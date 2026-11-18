// 出力マニフェスト（export-manifest.json）の形式と読み書きの関数（10: 実行結果の記録・R3・D4）。
// ファイルの読み書きそのものは呼び出し側が行う。ここは文字列との変換と、結果の反映だけを持つ。
import { refKey } from "./output-plan";
import type { ManifestEntry, ManifestSnapshot, NoteResult } from "./types";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILE_NAME = "export-manifest.json";

export interface ParsedManifest {
	snapshot: ManifestSnapshot;
	/** 内容が壊れていた（JSON として読めない、形が違う）。呼び出し側は元のファイルを退避して警告する */
	broken: boolean;
}

/** マニフェストの文字列を読む。ファイルがない（null）なら空。壊れていれば空として扱い broken を立てる。 */
export function parseManifest(text: string | null): ParsedManifest {
	if (text === null) return { snapshot: { entries: [] }, broken: false };
	try {
		const data = JSON.parse(text) as unknown;
		if (!isRecord(data) || data.version !== MANIFEST_VERSION || !Array.isArray(data.entries)) throw new Error("shape");
		const entries = data.entries.filter(isEntry);
		return { snapshot: { entries }, broken: entries.length !== data.entries.length };
	} catch {
		return { snapshot: { entries: [] }, broken: true };
	}
}

export function serializeManifest(snapshot: ManifestSnapshot): string {
	return JSON.stringify({ version: MANIFEST_VERSION, entries: snapshot.entries }, null, "\t") + "\n";
}

/**
 * 実行の結果をマニフェストに反映した新しい写しを返す（実行の最後に 1 回: D4）。
 * - 書き込んだ・変更なしの出力: 記録を足すか、置き換える
 * - スキップ・失敗した出力: 既存の記録をそのまま残す
 * - 削除した古い画像: 記録から消す
 */
export function applyResults(snapshot: ManifestSnapshot, results: readonly NoteResult[], now: string): ManifestSnapshot {
	const map = new Map<string, ManifestEntry>(snapshot.entries.map((e) => [refKey(e.output), e]));
	/** 今回の実行で書いた出力 → 元ノート。束ねた出力（1 フォルダ = 1 ブック）では、すべての元ノートを記録する */
	const sourcesThisRun = new Map<string, string[]>();
	for (const note of results) {
		for (const ref of note.deleted) map.delete(refKey(ref));
		for (const file of note.files) {
			if ((file.status !== "success" && file.status !== "unchanged") || !file.contentHash) continue;
			const key = refKey(file.output);
			const prev = map.get(key);
			const sources = sourcesThisRun.get(key) ?? [];
			if (!sources.includes(note.notePath)) sources.push(note.notePath);
			sourcesThisRun.set(key, sources);
			map.set(key, {
				output: file.output,
				sources: [...sources],
				kind: file.kind,
				...(file.diagramIndex !== undefined ? { diagramIndex: file.diagramIndex } : {}),
				contentHash: file.contentHash,
				writtenAt: file.status === "unchanged" && prev?.contentHash === file.contentHash ? prev.writtenAt : now,
			});
		}
	}
	const entries = [...map.values()].sort((a, b) => refKey(a.output).localeCompare(refKey(b.output)));
	return { entries };
}

function isEntry(value: unknown): value is ManifestEntry {
	if (!isRecord(value) || !isRecord(value.output)) return false;
	const o = value.output;
	return (
		(o.location === "vault" || o.location === "external") &&
		typeof o.path === "string" &&
		Array.isArray(value.sources) &&
		value.sources.every((s) => typeof s === "string") &&
		(value.kind === "image" || value.kind === "docx" || value.kind === "xlsx") &&
		typeof value.contentHash === "string" &&
		typeof value.writtenAt === "string" &&
		(value.diagramIndex === undefined || typeof value.diagramIndex === "number")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
