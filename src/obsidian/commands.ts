// 起動方法の登録（R2）: ファイル・フォルダの右クリック、複数選択の右クリック、コマンド「現在のノート」「Vault 全体」。
// 「Mermaid 画像として保存」（フェーズ 1）・「Word に変換」（フェーズ 2）・「Excel に変換」（フェーズ 4a）・「PDF に変換」（フェーズ 7）を、同じ 4 つの起動方法から呼べるようにする。
import type { Menu, TAbstractFile } from "obsidian";
import { t, type MessageKey } from "../i18n";
import { hasConvertibleItem, type TargetSource } from "./collect";
import { runExport, type ExportMode } from "./export-runner";
import type BatchOfficeExportPlugin from "../main";

interface ModeEntry {
	mode: ExportMode;
	menu: MessageKey;
	icon: string;
	activeCommand: { id: string; name: MessageKey };
	vaultCommand: { id: string; name: MessageKey };
}

const ENTRIES: readonly ModeEntry[] = [
	{
		mode: "docx",
		menu: "menu.convertWord",
		icon: "file-text",
		activeCommand: { id: "convert-word-current-note", name: "command.convertWordActive" },
		vaultCommand: { id: "convert-word-vault", name: "command.convertWordVault" },
	},
	{
		mode: "xlsx",
		menu: "menu.convertExcel",
		icon: "sheet",
		activeCommand: { id: "convert-excel-current-note", name: "command.convertExcelActive" },
		vaultCommand: { id: "convert-excel-vault", name: "command.convertExcelVault" },
	},
	{
		mode: "pdf",
		menu: "menu.convertPdf",
		icon: "file-output",
		activeCommand: { id: "convert-pdf-current-note", name: "command.convertPdfActive" },
		vaultCommand: { id: "convert-pdf-vault", name: "command.convertPdfVault" },
	},
	{
		mode: "office",
		menu: "menu.convertOffice",
		icon: "files",
		activeCommand: { id: "convert-office-current-note", name: "command.convertOfficeActive" },
		vaultCommand: { id: "convert-office-vault", name: "command.convertOfficeVault" },
	},
	{
		mode: "mermaid",
		menu: "menu.saveMermaid",
		icon: "image-down",
		activeCommand: { id: "save-mermaid-images-current-note", name: "command.saveMermaidActive" },
		vaultCommand: { id: "save-mermaid-images-vault", name: "command.saveMermaidVault" },
	},
];

export function registerCommands(plugin: BatchOfficeExportPlugin): void {
	const run = (mode: ExportMode, source: TargetSource): void => {
		void runExport({ app: plugin.app, settings: plugin.settings, pluginDir: pluginDir(plugin) }, mode, source);
	};
	const addItems = (menu: Menu, items: TAbstractFile[]): void => {
		if (!hasConvertibleItem(items)) return;
		for (const entry of ENTRIES) {
			menu.addItem((item) =>
				item
					.setTitle(t(entry.menu))
					.setIcon(entry.icon)
					.onClick(() => run(entry.mode, { kind: "items", items })),
			);
		}
	};

	plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, file: TAbstractFile) => addItems(menu, [file])));
	plugin.registerEvent(plugin.app.workspace.on("files-menu", (menu, files: TAbstractFile[]) => addItems(menu, files)));

	for (const entry of ENTRIES) {
		plugin.addCommand({
			id: entry.activeCommand.id,
			name: t(entry.activeCommand.name),
			checkCallback: (checking) => {
				const file = plugin.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) run(entry.mode, { kind: "active" });
				return true;
			},
		});
		plugin.addCommand({
			id: entry.vaultCommand.id,
			name: t(entry.vaultCommand.name),
			callback: () => run(entry.mode, { kind: "vault" }),
		});
	}
	// Vault 全体の集計（A-34）: 専用のコマンドだけ（R8）
	plugin.addCommand({ id: "summarize-vault-excel", name: t("command.summarizeVault"), callback: () => run("summary", { kind: "vault" }) });
}

/** プラグインのフォルダ（Vault からの相対パス）。 */
export function pluginDir(plugin: BatchOfficeExportPlugin): string {
	return plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}
