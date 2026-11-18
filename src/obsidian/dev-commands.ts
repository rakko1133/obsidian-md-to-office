// 開発ビルドにだけ登録するコマンド（main.ts で __DEV__ のときだけ呼ぶ）。
// B4: docx と exceljs が Obsidian（Electron のレンダラプロセス）の中で動くかを確かめる。
// フェーズ 3b: 他のプラグインのコードブロックの取り込み（A-26）を確かめるため、SVG と canvas を描くテスト用の処理を登録する。
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
	// ```boe-test-svg``` : 本文の文字をラベルにした SVG の図
	plugin.registerMarkdownCodeBlockProcessor("boe-test-svg", (source, el) => {
		const label = source.trim() || "SVG";
		const ns = "http://www.w3.org/2000/svg";
		const svg = activeDocument.createElementNS(ns, "svg");
		svg.setAttribute("width", "320");
		svg.setAttribute("height", "120");
		svg.setAttribute("viewBox", "0 0 320 120");
		const rect = activeDocument.createElementNS(ns, "rect");
		for (const [k, v] of Object.entries({ x: "4", y: "4", width: "312", height: "112", rx: "12", fill: "#dbeafe", stroke: "#1d4ed8", "stroke-width": "4" })) rect.setAttribute(k, v);
		const text = activeDocument.createElementNS(ns, "text");
		for (const [k, v] of Object.entries({ x: "160", y: "68", "text-anchor": "middle", "font-size": "24", fill: "#1e3a8a" })) text.setAttribute(k, v);
		text.textContent = label;
		svg.append(rect, text);
		el.appendChild(svg);
	});
	// ```boe-test-canvas``` : 少し遅れて描く canvas（描画の完了待ちを確かめる）
	plugin.registerMarkdownCodeBlockProcessor("boe-test-canvas", (source, el) => {
		const canvas = el.createEl("canvas");
		canvas.width = 300;
		canvas.height = 100;
		window.setTimeout(() => {
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.fillStyle = "#fde68a";
			ctx.fillRect(0, 0, 300, 100);
			ctx.fillStyle = "#92400e";
			ctx.font = "20px sans-serif";
			ctx.fillText(source.trim() || "canvas", 20, 58);
			el.createEl("p", { text: "canvas の下の段落" });
		}, 300);
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
