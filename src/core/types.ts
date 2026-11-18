// コンポーネント間の受け渡しの型（フェーズ 1 の完了条件 F1）。Obsidian API に依存しない。
// 決定事項 D1〜D7（docs/design/flows/ の「決定済み」）と、requirements.md の「フェーズ 1 の決定事項」に対応する。

import type { PluginSettings } from "./settings";

/** 出力先の場所（G4）。Vault 内か、Vault 外の絶対パスか。 */
export type OutputLocation = "vault" | "external";

/** 出力ファイルの位置。`path` は Vault 内なら Vault からの相対パス、Vault 外なら出力ルートからの相対パス（R3）。 */
export interface OutputRef {
	location: OutputLocation;
	path: string;
}

/** 変換対象の候補（01: 変換対象の収集）。 */
export interface TargetCandidate {
	/** Vault からの相対パス */
	path: string;
	/** 右クリックや「現在のノート」で直接選ばれたか。直接選んだノートには glob の除外を適用しない */
	explicit: boolean;
	/** frontmatter の `export` の値（なければ undefined） */
	frontmatterExport: unknown;
}

/** 除外したノートとその理由。 */
export interface ExcludedTarget {
	path: string;
	reason: "glob" | "frontmatter" | "notMarkdown";
}

/** 警告。各処理が結果と一緒に返し、03 がノートごとにまとめる。 */
export interface Warning {
	code: WarningCode;
	/** 補足（図の連番・エラーメッセージなど） */
	detail?: string;
}

export type WarningCode =
	| "mermaidRenderFailed"
	| "pngFailedSvgOnly"
	| "noDiagrams"
	| "manifestBroken"
	| "manifestSaveFailed"
	| "planChanged"
	| "cacheFailed"
	| "unsupportedSyntax"
	| "brokenLink"
	| "embedCycle"
	| "embedDepth"
	| "imageFailed"
	| "unsupportedEmbed"
	| "pluginMissing"
	| "renderFailed"
	| "mathAsImage"
	| "mathFailed"
	| "cellTruncated";

/** 予定動作（ドライラン: R3）。 */
export type PlannedAction = "create" | "overwrite" | "unchanged" | "skip" | "rename";

/** 出力ファイル 1 つごとの結果（09 が返す: D5）。 */
export interface FileResult {
	output: OutputRef;
	kind: OutputKind;
	status: "success" | "unchanged" | "skipped" | "failed";
	reason?: string;
	/** 書き込んだ内容の SHA-256（16 進）。09 が計算する */
	contentHash?: string;
	/** 図の連番（画像のとき） */
	diagramIndex?: number;
}

export type OutputKind = "image" | "docx" | "xlsx";

/** ノートごとの結果（03 が集約: D5）。状態は出力のうちいちばん重いもの（失敗 > スキップ > 成功）。 */
export interface NoteResult {
	notePath: string;
	status: "success" | "skipped" | "failed";
	files: FileResult[];
	warnings: Warning[];
	/** 失敗・スキップの理由（タイムアウトなど） */
	reason?: string;
	/** 削除した古い画像 */
	deleted: OutputRef[];
}

/** 実行全体の終わり方。 */
export type RunEnd = "completed" | "cancelled" | "failFast";

/** ノート 1 件ごとの文脈（03 が作る: D2・D4）。 */
export interface NoteContext {
	notePath: string;
	/** タイムアウトしたときだけ abort される（中断ボタンでは abort しない: D1） */
	signal: AbortSignal;
	manifest: ManifestSnapshot;
	settings: Readonly<PluginSettings>;
}

/** マニフェストの 1 件（R3）。 */
export interface ManifestEntry {
	output: OutputRef;
	/** 元ノート（Vault からの相対パス）。束ねた出力では複数になる */
	sources: string[];
	kind: OutputKind;
	/** 図の連番（画像のとき）。古い画像の検索に使う（R4） */
	diagramIndex?: number;
	contentHash: string;
	/** ISO 8601 */
	writtenAt: string;
}

/** 実行の開始時に 1 回読んだマニフェストの読み取り専用の写し（D4）。 */
export interface ManifestSnapshot {
	readonly entries: readonly ManifestEntry[];
}
