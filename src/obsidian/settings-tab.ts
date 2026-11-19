// 設定画面（G5）。項目の一覧と既定値は docs/design/settings.md に従う。
// Obsidian 1.13 からの宣言型の設定 API（getSettingDefinitions）で作る。項目が Obsidian の設定の検索に出る。
// 値の読み書きは getControlValue / setControlValue に集め、保存するときは normalizeSettings で形をそろえる。
// 1 行に入力欄が複数ある項目（出力形式・余白・フォント）は render で組み立てる。
import { App, PluginSettingTab, type Setting, type SettingDefinition, type SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS, OUTPUT_FORMATS, normalizeSettings, parseLines, type PluginSettings } from "../core/settings";
import { t } from "../i18n";
import type BatchOfficeExportPlugin from "../main";

type SettingKey = keyof PluginSettings;
type MarginKey = "marginsMm" | "pdfMarginsMm";
type FontPair = readonly ["bodyFontEastAsia", "bodyFontLatin"] | readonly ["headingFontEastAsia", "headingFontLatin"];

/** 複数行の入力欄で、1 行に 1 つずつ書く項目（値は文字列の配列） */
const LINE_LIST_KEYS: ReadonlySet<string> = new Set<SettingKey>(["includeGlobs", "excludeGlobs"]);
/** 数値の入力欄の項目（値が文字列で届いても数値にする） */
const NUMBER_KEYS: ReadonlySet<string> = new Set<SettingKey>(["timeoutSeconds", "pngDpi", "pdfScale", "pdfFontSizePt"]);
/** 入力中の値をそのまま持つ項目（形は画面を閉じるときに整える: hide） */
const RAW_TEXT_KEYS: ReadonlySet<string> = new Set<SettingKey>(["outputRoot"]);

export class BatchOfficeExportSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: BatchOfficeExportPlugin,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const outputInVault = (): boolean => this.plugin.settings.outputLocation === "vault";
		return [
			{
				type: "group",
				heading: t("settings.heading.output"),
				items: [
					this.defaultFormatsRow(),
					dropdown("outputLocation", t("settings.outputLocation.name"), t("settings.outputLocation.desc"), {
						vault: t("settings.outputLocation.vault"),
						external: t("settings.outputLocation.external"),
					}),
					{
						name: t("settings.outputRoot.name"),
						desc: t("settings.outputRoot.desc"),
						visible: outputInVault,
						control: { type: "text", key: "outputRoot", placeholder: DEFAULT_SETTINGS.outputRoot },
					},
					{
						name: t("settings.externalOutputRoot.name"),
						desc: t("settings.externalOutputRoot.desc"),
						visible: () => !outputInVault(),
						control: { type: "text", key: "externalOutputRoot" },
					},
					dropdown("saveMode", t("settings.saveMode.name"), t("settings.saveMode.desc"), {
						mirror: t("settings.saveMode.mirror"),
						sameFolder: t("settings.saveMode.sameFolder"),
					}),
					dropdown("onConflict", t("settings.onConflict.name"), undefined, {
						overwrite: t("settings.onConflict.overwrite"),
						skip: t("settings.onConflict.skip"),
						rename: t("settings.onConflict.rename"),
					}),
				],
			},
			{
				type: "group",
				heading: t("settings.heading.targets"),
				items: [
					{ name: t("settings.includeGlobs.name"), desc: t("settings.includeGlobs.desc"), control: { type: "textarea", key: "includeGlobs" } },
					{ name: t("settings.excludeGlobs.name"), desc: t("settings.excludeGlobs.desc"), control: { type: "textarea", key: "excludeGlobs" } },
				],
			},
			{
				type: "group",
				heading: t("settings.heading.run"),
				items: [
					dropdown("onError", t("settings.onError.name"), undefined, {
						continue: t("settings.onError.continue"),
						failFast: t("settings.onError.failFast"),
					}),
					{ name: t("settings.timeout.name"), control: { type: "number", key: "timeoutSeconds", min: 1, step: 1 } },
				],
			},
			{
				type: "group",
				heading: t("settings.heading.mermaid"),
				items: [
					dropdown("mermaidImageFormat", t("settings.imageFormat.name"), undefined, { png: "PNG", svg: "SVG", both: t("settings.imageFormat.both") }),
					{ name: t("settings.pngDpi.name"), control: { type: "number", key: "pngDpi", min: 1, step: 1 } },
					toggle("pngTransparentBackground", t("settings.transparent.name")),
					{ name: t("settings.font.name"), desc: t("settings.font.desc"), control: { type: "text", key: "mermaidFontFamily" } },
					toggle("saveImageFiles", t("settings.saveImageFiles.name"), t("settings.saveImageFiles.desc")),
				],
			},
			{
				type: "group",
				heading: t("settings.heading.word"),
				items: [
					dropdown("paperSize", t("settings.paperSize.name"), undefined, { A4: "A4", B5: "B5", Letter: "Letter" }),
					dropdown("orientation", t("settings.orientation.name"), undefined, {
						portrait: t("settings.orientation.portrait"),
						landscape: t("settings.orientation.landscape"),
					}),
					this.marginsRow("marginsMm"),
					this.fontRow(t("settings.bodyFont.name"), ["bodyFontEastAsia", "bodyFontLatin"]),
					this.fontRow(t("settings.headingFont.name"), ["headingFontEastAsia", "headingFontLatin"]),
					toggle("fileNameAsTitle", t("settings.fileNameAsTitle.name"), t("settings.fileNameAsTitle.desc")),
					{ name: t("settings.authorName.name"), desc: t("settings.authorName.desc"), control: { type: "text", key: "authorName" } },
					toggle("strictLineBreaksFallback", t("settings.strictLineBreaks.name"), t("settings.strictLineBreaks.desc")),
					toggle("codeLineNumbers", t("settings.codeLineNumbers.name")),
					toggle("keepCommentsAsWordComments", t("settings.keepComments.name"), t("settings.keepComments.desc")),
					toggle("frontmatterTable", t("settings.frontmatterTable.name"), t("settings.frontmatterTable.desc")),
					toggle("downloadExternalImages", t("settings.downloadExternalImages.name"), t("settings.downloadExternalImages.desc")),
					dropdown("calloutColorSource", t("settings.calloutColor.name"), undefined, {
						fixed: t("settings.calloutColor.fixed"),
						theme: t("settings.calloutColor.theme"),
					}),
					toggle("footerPageNumber", t("settings.footerPageNumber.name"), t("settings.footerPageNumber.desc")),
					toggle("headerTitle", t("settings.headerTitle.name")),
					toggle("coverPage", t("settings.coverPage.name"), t("settings.coverPage.desc")),
					dropdown("tableOfContents", t("settings.tableOfContents.name"), t("settings.tableOfContents.desc"), {
						never: t("settings.tableOfContents.never"),
						combined: t("settings.tableOfContents.combined"),
						always: t("settings.tableOfContents.always"),
					}),
					dropdown("combineOrder", t("settings.combineOrder.name"), t("settings.combineOrder.desc"), {
						fileName: t("settings.combineOrder.fileName"),
						frontmatterOrder: t("settings.combineOrder.frontmatterOrder"),
						moc: t("settings.combineOrder.moc"),
					}),
					toggle("defaultCombine", t("settings.defaultCombine.name"), t("settings.defaultCombine.desc")),
					{ name: t("settings.wordTemplatePath.name"), desc: t("settings.wordTemplatePath.desc"), control: { type: "text", key: "wordTemplatePath" } },
					toggle("headingNumbering", t("settings.headingNumbering.name"), t("settings.headingNumbering.desc")),
					toggle("pageBreakBeforeH1", t("settings.pageBreakBeforeH1.name")),
					toggle("tableFullWidth", t("settings.tableFullWidth.name")),
					toggle("figureCaptions", t("settings.figureCaptions.name"), t("settings.figureCaptions.desc")),
					toggle("tableCaptions", t("settings.tableCaptions.name"), t("settings.tableCaptions.desc")),
				],
			},
			{
				type: "group",
				heading: t("settings.heading.excel"),
				items: [
					dropdown("excelBookUnit", t("settings.excelBookUnit.name"), t("settings.excelBookUnit.desc"), {
						perFolder: t("settings.excelBookUnit.perFolder"),
						perNote: t("settings.excelBookUnit.perNote"),
					}),
					dropdown("excelSheetUnit", t("settings.excelSheetUnit.name"), undefined, {
						perNote: t("settings.excelSheetUnit.perNote"),
						perTable: t("settings.excelSheetUnit.perTable"),
					}),
					toggle("excelAsTable", t("settings.excelAsTable.name"), t("settings.excelAsTable.desc")),
					toggle("excelOutlineMode", t("settings.excelOutlineMode.name"), t("settings.excelOutlineMode.desc")),
					toggle("excelSourceColumns", t("settings.excelSourceColumns.name"), t("settings.excelSourceColumns.desc")),
				],
			},
			{
				// PDF（H1-PDF）: ページ設定だけ Word と別に持つ
				type: "group",
				heading: t("settings.heading.pdf"),
				items: [
					// 名前のない説明だけの行。名前が空の項目は描かれないので、render で説明を入れる
					{ name: t("settings.heading.pdf"), searchable: false, render: (setting: Setting) => void setting.setName("").setDesc(t("settings.pdf.desc")) },
					dropdown("pdfPaperSize", t("settings.paperSize.name"), undefined, { A4: "A4", A3: "A3", B5: "B5", Letter: "Letter" }),
					dropdown("pdfOrientation", t("settings.orientation.name"), undefined, {
						portrait: t("settings.orientation.portrait"),
						landscape: t("settings.orientation.landscape"),
					}),
					this.marginsRow("pdfMarginsMm"),
					{ name: t("settings.pdfScale.name"), desc: t("settings.pdfScale.desc"), control: { type: "number", key: "pdfScale", min: 10, max: 200, step: 1 } },
					{ name: t("settings.pdfFontSize.name"), desc: t("settings.pdfFontSize.desc"), control: { type: "number", key: "pdfFontSizePt", min: 6, max: 24, step: 0.5 } },
					{ name: t("settings.pdfFont.name"), desc: t("settings.pdfFont.desc"), control: { type: "text", key: "pdfFontFamily", placeholder: t("settings.pdfFont.placeholder") } },
					{ name: t("settings.pdfCodeFont.name"), desc: t("settings.pdfCodeFont.desc"), control: { type: "text", key: "pdfCodeFontFamily", placeholder: t("settings.pdfFont.placeholder") } },
				],
			},
		];
	}

	override getControlValue(key: string): unknown {
		const value = (this.plugin.settings as unknown as Record<string, unknown>)[key];
		return LINE_LIST_KEYS.has(key) && Array.isArray(value) ? value.join("\n") : value;
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const stored =
			LINE_LIST_KEYS.has(key) && typeof value === "string" ? parseLines(value) : NUMBER_KEYS.has(key) && typeof value === "string" ? Number(value) : value;
		await this.saveValue(key as SettingKey, stored);
		// 出力先を切り替えると、出す入力欄（Vault の中のフォルダ / Vault の外のフォルダ）が変わる
		if (key === "outputLocation") this.refreshDomState();
	}

	override hide(): void {
		// 画面を閉じるときに、入力中だった値も含めて形を整えて保存する
		this.plugin.settings = normalizeSettings(this.plugin.settings);
		void this.plugin.saveSettings();
	}

	private async saveValue(key: SettingKey, value: unknown): Promise<void> {
		if (RAW_TEXT_KEYS.has(key) && typeof value === "string") {
			// 入力中の値はそのまま持ち、保存するときに形を整える
			this.plugin.settings = { ...this.plugin.settings, [key]: value };
		} else {
			// 値の形は normalizeSettings でそろえる（壊れた値は既定値に戻る）
			this.plugin.settings = normalizeSettings({ ...this.plugin.settings, [key]: value });
		}
		await this.plugin.saveSettings();
	}

	/** 出力形式の初期値: 形式ごとのトグルを 1 行に並べる。全部外したときは既定値（Word）に戻る（normalizeSettings） */
	private defaultFormatsRow(): SettingDefinition {
		return {
			name: t("settings.defaultFormats.name"),
			desc: t("settings.defaultFormats.desc"),
			render: (setting: Setting) => {
				for (const format of OUTPUT_FORMATS) {
					setting.addToggle((tg) => {
						tg.setTooltip(t(`format.${format}`))
							.setValue(this.plugin.settings.defaultFormats.includes(format))
							.onChange(async (v) => {
								const current = new Set(this.plugin.settings.defaultFormats);
								if (v) current.add(format);
								else current.delete(format);
								await this.saveValue(
									"defaultFormats",
									OUTPUT_FORMATS.filter((f) => current.has(f)),
								);
							});
						tg.toggleEl.insertAdjacentText("beforebegin", t(`format.${format}`));
					});
				}
			},
		};
	}

	/** 余白（上・下・左・右、mm）を 1 行に並べる */
	private marginsRow(key: MarginKey): SettingDefinition {
		return {
			name: t("settings.margins.name"),
			render: (setting: Setting) => {
				for (const side of ["top", "bottom", "left", "right"] as const) {
					setting.addText((text) => {
						text.inputEl.type = "number";
						text.inputEl.addClass("batch-office-export-margin-input");
						text.setValue(String(this.plugin.settings[key][side])).onChange(async (v) => this.saveValue(key, { ...this.plugin.settings[key], [side]: Number(v) }));
					});
				}
			},
		};
	}

	/** フォント（和文・欧文）を 1 行に並べる */
	private fontRow(name: string, keys: FontPair): SettingDefinition {
		return {
			name,
			render: (setting: Setting) => {
				for (const key of keys) {
					setting.addText((text) => text.setValue(this.plugin.settings[key]).onChange(async (v) => this.saveValue(key, v)));
				}
			},
		};
	}
}

function toggle(key: SettingKey, name: string, desc?: string): SettingDefinition {
	return { name, ...(desc ? { desc } : {}), control: { type: "toggle", key } };
}

function dropdown(key: SettingKey, name: string, desc: string | undefined, options: Record<string, string>): SettingDefinition {
	return { name, ...(desc ? { desc } : {}), control: { type: "dropdown", key, options } };
}
