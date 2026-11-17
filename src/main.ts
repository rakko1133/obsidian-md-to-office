// プラグインの入口。Obsidian に依存する処理は src/obsidian/、依存しない中核は src/core/ に置く（G2・G4）。
import { Plugin, getLanguage } from "obsidian";
import { normalizeSettings, type PluginSettings } from "./core/settings";
import { setLocale } from "./i18n";
import { registerDevCommands } from "./obsidian/dev-commands";
import { BatchOfficeExportSettingTab } from "./obsidian/settings-tab";

export default class BatchOfficeExportPlugin extends Plugin {
	override settings!: PluginSettings;

	override async onload(): Promise<void> {
		setLocale(getLanguage());
		await this.loadSettings();
		this.addSettingTab(new BatchOfficeExportSettingTab(this.app, this));
		if (__DEV__) registerDevCommands(this);
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
