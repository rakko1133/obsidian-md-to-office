// 出力パスの計算と予定動作の判定（09 のサブフロー A・02 のドライランと共用: R3・R8）。
// 純粋関数だけを置く。Obsidian API とファイルシステムに依存しない。
import type { PluginSettings } from "./settings";
import type { ManifestSnapshot, OutputRef, PlannedAction } from "./types";

/** パスのフォルダ部分（Vault からの相対パス）。ルート直下なら空文字。 */
export function dirName(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "" : path.slice(0, i);
}

/** 拡張子 .md を除いたファイル名。 */
export function noteBaseName(notePath: string): string {
	return baseName(notePath).replace(/\.md$/i, "");
}

/** パスの最後の要素（ファイル名）。 */
export function baseName(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}

/** パスを `/` でつなぐ。空の要素は飛ばす。 */
export function joinPath(...parts: string[]): string {
	return parts.filter((p) => p !== "").join("/");
}

/**
 * ノートの出力先フォルダ（R1・R8・G4）。
 * - ミラー出力: 出力ルートの下に、元と同じフォルダ構成
 * - 同一フォルダ: 元ノートと同じフォルダ（Vault 内のみ）
 */
export function outputDirFor(notePath: string, settings: Pick<PluginSettings, "saveMode" | "outputLocation" | "outputRoot">): OutputRef {
	const dir = dirName(notePath);
	if (settings.saveMode === "sameFolder") return { location: "vault", path: dir };
	if (settings.outputLocation === "external") return { location: "external", path: dir };
	return { location: "vault", path: joinPath(settings.outputRoot, dir) };
}

/** 2 つの出力位置が同じか。 */
export function sameRef(a: OutputRef, b: OutputRef): boolean {
	return a.location === b.location && a.path === b.path;
}

export function refKey(ref: OutputRef): string {
	return `${ref.location}:${ref.path}`;
}

/**
 * 予定動作を決める（R3）。
 * - ファイルがない: 新規
 * - 同じ名前なら同じ内容とみなせる出力（ハッシュ入りの画像）: 変更なし
 * - それ以外は同名ファイルの設定に従う
 */
export function plannedAction(exists: boolean, nameImpliesContent: boolean, onConflict: PluginSettings["onConflict"]): PlannedAction {
	if (!exists) return "create";
	if (nameImpliesContent) return "unchanged";
	switch (onConflict) {
		case "overwrite":
			return "overwrite";
		case "skip":
			return "skip";
		case "rename":
			return "rename";
	}
}

/** 連番を付けたパス `name (1).ext`。exists が false を返す最初の番号を使う（R3）。 */
export function renamedPath(path: string, exists: (candidate: string) => boolean): string {
	const dot = path.lastIndexOf(".");
	const slash = path.lastIndexOf("/");
	const hasExt = dot > slash + 1;
	const stem = hasExt ? path.slice(0, dot) : path;
	const ext = hasExt ? path.slice(dot) : "";
	for (let n = 1; n < 10000; n++) {
		const candidate = `${stem} (${n})${ext}`;
		if (!exists(candidate)) return candidate;
	}
	throw new Error(`no free name for ${path}`);
}

/** 書き込んではいけないパスか（元ノートの保護: R3）。拡張子 .md・.canvas と、今回の変換元。 */
export function isProtectedPath(ref: OutputRef, sources: ReadonlySet<string>): boolean {
	if (/\.(md|canvas)$/i.test(ref.path)) return true;
	return ref.location === "vault" && sources.has(ref.path);
}

/**
 * 古い画像を探す（R4）。同じノート・同じ図の連番としてマニフェストに記録された画像のうち、今回の出力に含まれないもの。
 * マニフェストに記録のないファイルは対象にしない。
 */
export function findOldImages(manifest: ManifestSnapshot, notePath: string, diagramIndex: number, keep: readonly OutputRef[]): OutputRef[] {
	const keepKeys = new Set(keep.map(refKey));
	return manifest.entries
		.filter((e) => e.kind === "image" && e.diagramIndex === diagramIndex && e.sources.length === 1 && e.sources[0] === notePath)
		.map((e) => e.output)
		.filter((ref) => !keepKeys.has(refKey(ref)));
}

/** 出力ファイルどうしの相対 URL（.docx の中の内部リンク: A-18）。空白・`%`・`#` だけを符号化する。 */
export function relativeUrl(from: OutputRef, to: OutputRef): string | null {
	if (from.location !== to.location) return null;
	const fromDir = dirName(from.path).split("/").filter((s) => s !== "");
	const toParts = to.path.split("/").filter((s) => s !== "");
	let common = 0;
	while (common < fromDir.length && common < toParts.length - 1 && fromDir[common] === toParts[common]) common++;
	const parts = [...Array<string>(fromDir.length - common).fill(".."), ...toParts.slice(common)];
	return parts.map((p) => p.replace(/%/g, "%25").replace(/ /g, "%20").replace(/#/g, "%23")).join("/");
}
