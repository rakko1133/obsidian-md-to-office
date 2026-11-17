// 開発ビルドにだけ登録するコマンド（main.ts で __DEV__ のときだけ呼ぶ）。
// B4: docx と exceljs が Obsidian（Electron のレンダラプロセス）の中で動くかを確かめる。
import { Notice, normalizePath } from "obsidian";
import { buildSampleDocx, buildSampleXlsx } from "../core/sample-files";
import { normalizeFolderPath, DEFAULT_SETTINGS } from "../core/settings";
import { t } from "../i18n";
import type BatchOfficeExportPlugin from "../main";

export function registerDevCommands(plugin: BatchOfficeExportPlugin): void {
	plugin.addCommand({
		id: "dev-write-sample-files",
		name: t("command.devWriteSamples"),
		callback: () => void writeSampleFiles(plugin),
	});
}

async function writeSampleFiles(plugin: BatchOfficeExportPlugin): Promise<void> {
	const root = normalizeFolderPath(plugin.settings.outputRoot, DEFAULT_SETTINGS.outputRoot);
	const folder = normalizePath(`${root}/_dev`);
	try {
		const adapter = plugin.app.vault.adapter;
		if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
		await adapter.writeBinary(`${folder}/sample.docx`, await buildSampleDocx());
		await adapter.writeBinary(`${folder}/sample.xlsx`, await buildSampleXlsx());
		new Notice(t("notice.devWriteSamples.done", { path: folder }));
	} catch (error) {
		console.error("[batch-office-export]", error);
		new Notice(t("notice.devWriteSamples.failed", { error: String(error) }));
	}
}
