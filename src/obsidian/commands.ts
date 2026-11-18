// 起動方法の登録（R2）: ファイル・フォルダの右クリック、複数選択の右クリック、コマンド「現在のノート」「Vault 全体」。
import type { TAbstractFile } from "obsidian";
import { t } from "../i18n";
import { hasConvertibleItem, type TargetSource } from "./collect";
import { saveMermaidImages } from "./export-mermaid";
import type BatchOfficeExportPlugin from "../main";

export function registerCommands(plugin: BatchOfficeExportPlugin): void {
	const run = (source: TargetSource): void => {
		void saveMermaidImages({ app: plugin.app, settings: plugin.settings, pluginDir: pluginDir(plugin) }, source);
	};

	plugin.registerEvent(
		plugin.app.workspace.on("file-menu", (menu, file: TAbstractFile) => {
			if (!hasConvertibleItem([file])) return;
			menu.addItem((item) =>
				item
					.setTitle(t("menu.saveMermaid"))
					.setIcon("image-down")
					.onClick(() => run({ kind: "items", items: [file] })),
			);
		}),
	);

	plugin.registerEvent(
		plugin.app.workspace.on("files-menu", (menu, files: TAbstractFile[]) => {
			if (!hasConvertibleItem(files)) return;
			menu.addItem((item) =>
				item
					.setTitle(t("menu.saveMermaid"))
					.setIcon("image-down")
					.onClick(() => run({ kind: "items", items: files })),
			);
		}),
	);

	plugin.addCommand({
		id: "save-mermaid-images-current-note",
		name: t("command.saveMermaidActive"),
		checkCallback: (checking) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file || file.extension !== "md") return false;
			if (!checking) run({ kind: "active" });
			return true;
		},
	});

	plugin.addCommand({
		id: "save-mermaid-images-vault",
		name: t("command.saveMermaidVault"),
		callback: () => run({ kind: "vault" }),
	});
}

function pluginDir(plugin: BatchOfficeExportPlugin): string {
	return plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}
