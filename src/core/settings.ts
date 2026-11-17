// プラグインの設定値の型と既定値。Obsidian API に依存しない（G2・G4）。
// 設定項目の一覧と既定値の正本は docs/design/settings.md。

export interface PluginSettings {
	/** 出力ルート。Vault 内のフォルダのパス（G4・R8）。 */
	outputRoot: string;
}

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
	outputRoot: "_export",
};

/**
 * data.json から読み込んだ値を、欠けている項目は既定値で補い、形を整えて返す。
 * 読み込んだ値が壊れていても例外にせず、既定値に戻す。
 */
export function normalizeSettings(raw: unknown): PluginSettings {
	const data = isRecord(raw) ? raw : {};
	return {
		outputRoot: normalizeFolderPath(data.outputRoot, DEFAULT_SETTINGS.outputRoot),
	};
}

/** Vault 内のフォルダのパスを整える。前後の空白と、先頭・末尾の `/` を除く。空なら既定値。 */
export function normalizeFolderPath(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	return trimmed === "" ? fallback : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
