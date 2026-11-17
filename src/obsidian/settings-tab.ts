// 設定画面（G5・B3）。項目の一覧と既定値は docs/design/settings.md に従う。
import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS } from "../core/settings";
import { t } from "../i18n";
import type BatchOfficeExportPlugin from "../main";

export class BatchOfficeExportSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BatchOfficeExportPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t("settings.outputRoot.name"))
			.setDesc(t("settings.outputRoot.desc"))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.outputRoot)
					.setValue(this.plugin.settings.outputRoot)
					.onChange(async (value) => {
						this.plugin.settings.outputRoot = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
