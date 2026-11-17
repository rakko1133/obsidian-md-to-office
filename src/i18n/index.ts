// UI 文字列の取得（H6）。Obsidian API に依存しない。言語は呼び出し側が setLocale() で渡す。
import { en, type MessageKey } from "./en";
import { ja } from "./ja";

const MESSAGES: Record<string, Record<MessageKey, string>> = { en, ja };

let current: Record<MessageKey, string> = en;

/** Obsidian の表示言語（例: "en"、"ja"）を設定する。対応していない言語は英語にする。 */
export function setLocale(language: string): void {
	current = MESSAGES[language] ?? en;
}

/** キーに対応する文字列を返す。`{name}` は params の値で置き換える。 */
export function t(key: MessageKey, params: Record<string, string> = {}): string {
	return current[key].replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

export type { MessageKey };
