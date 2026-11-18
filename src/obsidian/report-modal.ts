// 結果レポート（10・R3）。件数を出し、明細は種類ごとに折りたためるようにする。
import { type App, Modal, Setting } from "obsidian";
import type { NoteResult, RunEnd, Warning } from "../core/types";
import { t, type MessageKey } from "../i18n";

export interface ReportData {
	end: RunEnd;
	results: readonly NoteResult[];
	/** ノートに属さない警告（マニフェストなど） */
	runWarnings: readonly Warning[];
}

export function showReport(app: App, data: ReportData): void {
	new ReportModal(app, data).open();
}

class ReportModal extends Modal {
	constructor(
		app: App,
		private readonly data: ReportData,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl } = this;
		const { results, end, runWarnings } = this.data;
		this.setTitle(t("report.title"));
		contentEl.createEl("p", { text: t(`report.end.${end}`) });

		const count = (s: NoteResult["status"]) => String(results.filter((r) => r.status === s).length);
		contentEl.createEl("p", { text: t("report.counts", { success: count("success"), skipped: count("skipped"), failed: count("failed") }) });
		const files = results.flatMap((r) => r.files);
		contentEl.createEl("p", {
			text: t("report.files", {
				written: String(files.filter((f) => f.status === "success").length),
				unchanged: String(files.filter((f) => f.status === "unchanged").length),
				deleted: String(results.reduce((n, r) => n + r.deleted.length, 0)),
			}),
		});

		this.section(t("report.section.failed"), results.filter((r) => r.status === "failed").map((r) => `${r.notePath}: ${describeNote(r)}`));
		this.section(t("report.section.skipped"), results.filter((r) => r.status === "skipped").map((r) => `${r.notePath}: ${describeNote(r)}`));
		const warnings = [
			...runWarnings.map((w) => describeWarning(w)),
			...results.flatMap((r) => r.warnings.filter((w) => w.code !== "noDiagrams").map((w) => `${r.notePath}: ${describeWarning(w)}`)),
		];
		this.section(t("report.section.warnings"), warnings);

		new Setting(contentEl).addButton((b) => b.setButtonText(t("report.close")).setCta().onClick(() => this.close()));
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private section(title: string, lines: string[]): void {
		if (lines.length === 0) return;
		const details = this.contentEl.createEl("details");
		details.createEl("summary", { text: `${title} (${lines.length})` });
		const ul = details.createEl("ul");
		for (const line of lines) ul.createEl("li", { text: line });
	}
}

function describeNote(r: NoteResult): string {
	const reasons = [r.reason, ...r.files.filter((f) => f.status === "failed" || f.status === "skipped").map((f) => f.reason)].filter(
		(x): x is string => !!x,
	);
	return [...new Set(reasons)].map(reasonText).join(", ");
}

function reasonText(reason: string): string {
	const key = `reason.${reason}` as MessageKey;
	return ["timeout", "noDiagrams", "inUse", "protected", "render"].includes(reason) ? t(key) : reason;
}

function describeWarning(w: Warning): string {
	const text = t(`warning.${w.code}` as MessageKey);
	return w.detail ? `${text} (${w.detail})` : text;
}
