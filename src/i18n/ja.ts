// 日本語の UI 文字列（H6）。キーは en.ts と同じにする（型で検査される）。
import type { MessageKey } from "./en";

export const ja: Record<MessageKey, string> = {
	"settings.outputRoot.name": "出力フォルダ",
	"settings.outputRoot.desc": "変換したファイルを保存する、Vault 内のフォルダ。",
	"command.devWriteSamples": "開発用: サンプルの .docx と .xlsx を書き出す",
	"notice.devWriteSamples.done": "サンプルを {path} に書き出しました",
	"notice.devWriteSamples.failed": "サンプルの書き出しに失敗しました: {error}",
};
