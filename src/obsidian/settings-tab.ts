// 設定画面（G5）。項目の一覧と既定値は docs/design/settings.md に従う。フェーズ 1 までの項目を出す。
import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_SETTINGS, normalizeSettings, parseLines, type PluginSettings } from "../core/settings";
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
		const s = this.plugin.settings;
		const save = async <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]): Promise<void> => {
			// 値の形は normalizeSettings でそろえる（壊れた値は既定値に戻る）
			this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
			await this.plugin.saveSettings();
		};

		// 出力
		new Setting(containerEl).setName(t("settings.heading.output")).setHeading();
		new Setting(containerEl)
			.setName(t("settings.outputLocation.name"))
			.setDesc(t("settings.outputLocation.desc"))
			.addDropdown((d) =>
				d
					.addOption("vault", t("settings.outputLocation.vault"))
					.addOption("external", t("settings.outputLocation.external"))
					.setValue(s.outputLocation)
					.onChange(async (v) => {
						await save("outputLocation", v as PluginSettings["outputLocation"]);
						this.display();
					}),
			);
		if (s.outputLocation === "vault") {
			new Setting(containerEl)
				.setName(t("settings.outputRoot.name"))
				.setDesc(t("settings.outputRoot.desc"))
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_SETTINGS.outputRoot)
						.setValue(s.outputRoot)
						.onChange(async (v) => {
							// 入力中の値はそのまま持ち、保存するときに形を整える
							this.plugin.settings.outputRoot = v;
							await this.plugin.saveSettings();
						}),
				);
		} else {
			new Setting(containerEl)
				.setName(t("settings.externalOutputRoot.name"))
				.setDesc(t("settings.externalOutputRoot.desc"))
				.addText((text) => text.setValue(s.externalOutputRoot).onChange(async (v) => save("externalOutputRoot", v)));
		}
		new Setting(containerEl)
			.setName(t("settings.saveMode.name"))
			.setDesc(t("settings.saveMode.desc"))
			.addDropdown((d) =>
				d
					.addOption("mirror", t("settings.saveMode.mirror"))
					.addOption("sameFolder", t("settings.saveMode.sameFolder"))
					.setValue(s.saveMode)
					.onChange(async (v) => save("saveMode", v as PluginSettings["saveMode"])),
			);
		new Setting(containerEl).setName(t("settings.onConflict.name")).addDropdown((d) =>
			d
				.addOption("overwrite", t("settings.onConflict.overwrite"))
				.addOption("skip", t("settings.onConflict.skip"))
				.addOption("rename", t("settings.onConflict.rename"))
				.setValue(s.onConflict)
				.onChange(async (v) => save("onConflict", v as PluginSettings["onConflict"])),
		);

		// 変換対象
		new Setting(containerEl).setName(t("settings.heading.targets")).setHeading();
		new Setting(containerEl)
			.setName(t("settings.includeGlobs.name"))
			.setDesc(t("settings.includeGlobs.desc"))
			.addTextArea((a) => a.setValue(s.includeGlobs.join("\n")).onChange(async (v) => save("includeGlobs", parseLines(v))));
		new Setting(containerEl)
			.setName(t("settings.excludeGlobs.name"))
			.setDesc(t("settings.excludeGlobs.desc"))
			.addTextArea((a) => a.setValue(s.excludeGlobs.join("\n")).onChange(async (v) => save("excludeGlobs", parseLines(v))));

		// 実行
		new Setting(containerEl).setName(t("settings.heading.run")).setHeading();
		new Setting(containerEl).setName(t("settings.onError.name")).addDropdown((d) =>
			d
				.addOption("continue", t("settings.onError.continue"))
				.addOption("failFast", t("settings.onError.failFast"))
				.setValue(s.onError)
				.onChange(async (v) => save("onError", v as PluginSettings["onError"])),
		);
		new Setting(containerEl).setName(t("settings.timeout.name")).addText((text) =>
			text.setValue(String(s.timeoutSeconds)).onChange(async (v) => save("timeoutSeconds", Number(v))),
		);

		// Mermaid の画像
		new Setting(containerEl).setName(t("settings.heading.mermaid")).setHeading();
		new Setting(containerEl).setName(t("settings.imageFormat.name")).addDropdown((d) =>
			d
				.addOption("png", "PNG")
				.addOption("svg", "SVG")
				.addOption("both", t("settings.imageFormat.both"))
				.setValue(s.mermaidImageFormat)
				.onChange(async (v) => save("mermaidImageFormat", v as PluginSettings["mermaidImageFormat"])),
		);
		new Setting(containerEl).setName(t("settings.pngDpi.name")).addText((text) => text.setValue(String(s.pngDpi)).onChange(async (v) => save("pngDpi", Number(v))));
		new Setting(containerEl)
			.setName(t("settings.transparent.name"))
			.addToggle((tg) => tg.setValue(s.pngTransparentBackground).onChange(async (v) => save("pngTransparentBackground", v)));
		new Setting(containerEl)
			.setName(t("settings.font.name"))
			.setDesc(t("settings.font.desc"))
			.addText((text) => text.setValue(s.mermaidFontFamily).onChange(async (v) => save("mermaidFontFamily", v)));
	}

	override hide(): void {
		// 画面を閉じるときに、入力中だった値も含めて形を整えて保存する
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		void this.plugin.saveSettings();
	}
}
