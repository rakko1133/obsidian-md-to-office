// 設定画面（G5）。項目の一覧と既定値は docs/design/settings.md に従う。フェーズ 3b までの項目を出す。
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
		new Setting(containerEl)
			.setName(t("settings.saveImageFiles.name"))
			.setDesc(t("settings.saveImageFiles.desc"))
			.addToggle((tg) => tg.setValue(s.saveImageFiles).onChange(async (v) => save("saveImageFiles", v)));

		// Word
		new Setting(containerEl).setName(t("settings.heading.word")).setHeading();
		new Setting(containerEl).setName(t("settings.paperSize.name")).addDropdown((d) =>
			d
				.addOption("A4", "A4")
				.addOption("B5", "B5")
				.addOption("Letter", "Letter")
				.setValue(s.paperSize)
				.onChange(async (v) => save("paperSize", v as PluginSettings["paperSize"])),
		);
		new Setting(containerEl).setName(t("settings.orientation.name")).addDropdown((d) =>
			d
				.addOption("portrait", t("settings.orientation.portrait"))
				.addOption("landscape", t("settings.orientation.landscape"))
				.setValue(s.orientation)
				.onChange(async (v) => save("orientation", v as PluginSettings["orientation"])),
		);
		const margin = new Setting(containerEl).setName(t("settings.margins.name"));
		for (const side of ["top", "bottom", "left", "right"] as const) {
			margin.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.style.width = "4.5em";
				text.setValue(String(s.marginsMm[side])).onChange(async (v) => save("marginsMm", { ...this.plugin.settings.marginsMm, [side]: Number(v) }));
			});
		}
		new Setting(containerEl)
			.setName(t("settings.bodyFont.name"))
			.addText((text) => text.setValue(s.bodyFontEastAsia).onChange(async (v) => save("bodyFontEastAsia", v)))
			.addText((text) => text.setValue(s.bodyFontLatin).onChange(async (v) => save("bodyFontLatin", v)));
		new Setting(containerEl)
			.setName(t("settings.headingFont.name"))
			.addText((text) => text.setValue(s.headingFontEastAsia).onChange(async (v) => save("headingFontEastAsia", v)))
			.addText((text) => text.setValue(s.headingFontLatin).onChange(async (v) => save("headingFontLatin", v)));
		new Setting(containerEl)
			.setName(t("settings.fileNameAsTitle.name"))
			.setDesc(t("settings.fileNameAsTitle.desc"))
			.addToggle((tg) => tg.setValue(s.fileNameAsTitle).onChange(async (v) => save("fileNameAsTitle", v)));
		new Setting(containerEl)
			.setName(t("settings.authorName.name"))
			.setDesc(t("settings.authorName.desc"))
			.addText((text) => text.setValue(s.authorName).onChange(async (v) => save("authorName", v)));
		new Setting(containerEl)
			.setName(t("settings.strictLineBreaks.name"))
			.setDesc(t("settings.strictLineBreaks.desc"))
			.addToggle((tg) => tg.setValue(s.strictLineBreaksFallback).onChange(async (v) => save("strictLineBreaksFallback", v)));
		new Setting(containerEl)
			.setName(t("settings.codeLineNumbers.name"))
			.addToggle((tg) => tg.setValue(s.codeLineNumbers).onChange(async (v) => save("codeLineNumbers", v)));
		new Setting(containerEl)
			.setName(t("settings.keepComments.name"))
			.setDesc(t("settings.keepComments.desc"))
			.addToggle((tg) => tg.setValue(s.keepCommentsAsWordComments).onChange(async (v) => save("keepCommentsAsWordComments", v)));
		new Setting(containerEl)
			.setName(t("settings.frontmatterTable.name"))
			.setDesc(t("settings.frontmatterTable.desc"))
			.addToggle((tg) => tg.setValue(s.frontmatterTable).onChange(async (v) => save("frontmatterTable", v)));
		new Setting(containerEl)
			.setName(t("settings.downloadExternalImages.name"))
			.setDesc(t("settings.downloadExternalImages.desc"))
			.addToggle((tg) => tg.setValue(s.downloadExternalImages).onChange(async (v) => save("downloadExternalImages", v)));
		new Setting(containerEl).setName(t("settings.calloutColor.name")).addDropdown((d) =>
			d
				.addOption("fixed", t("settings.calloutColor.fixed"))
				.addOption("theme", t("settings.calloutColor.theme"))
				.setValue(s.calloutColorSource)
				.onChange(async (v) => save("calloutColorSource", v as PluginSettings["calloutColorSource"])),
		);

		new Setting(containerEl).setName(t("settings.heading.excel")).setHeading();
		new Setting(containerEl)
			.setName(t("settings.excelBookUnit.name"))
			.setDesc(t("settings.excelBookUnit.desc"))
			.addDropdown((d) =>
				d
					.addOption("perFolder", t("settings.excelBookUnit.perFolder"))
					.addOption("perNote", t("settings.excelBookUnit.perNote"))
					.setValue(s.excelBookUnit)
					.onChange(async (v) => save("excelBookUnit", v as PluginSettings["excelBookUnit"])),
			);
		new Setting(containerEl).setName(t("settings.excelSheetUnit.name")).addDropdown((d) =>
			d
				.addOption("perNote", t("settings.excelSheetUnit.perNote"))
				.addOption("perTable", t("settings.excelSheetUnit.perTable"))
				.setValue(s.excelSheetUnit)
				.onChange(async (v) => save("excelSheetUnit", v as PluginSettings["excelSheetUnit"])),
		);
		new Setting(containerEl)
			.setName(t("settings.excelAsTable.name"))
			.setDesc(t("settings.excelAsTable.desc"))
			.addToggle((tg) => tg.setValue(s.excelAsTable).onChange(async (v) => save("excelAsTable", v)));
	}

	override hide(): void {
		// 画面を閉じるときに、入力中だった値も含めて形を整えて保存する
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		void this.plugin.saveSettings();
	}
}
