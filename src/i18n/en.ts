// 英語の UI 文字列（H6）。キーを足すときは ja.ts にも同じキーを足す。
export const en = {
	"settings.outputRoot.name": "Output folder",
	"settings.outputRoot.desc": "Folder in the vault where converted files are saved.",
	"command.devWriteSamples": "Developer: write sample .docx and .xlsx",
	"notice.devWriteSamples.done": "Sample files written to {path}",
	"notice.devWriteSamples.failed": "Failed to write sample files: {error}",
} as const;

export type MessageKey = keyof typeof en;
