// 進捗表示と中断ボタン（03・R3）。消えない Notice に「n / 全体件数」と処理中のファイル名を出す。
import { Notice } from "obsidian";
import { t } from "../i18n";

export class ProgressNotice {
	private readonly notice: Notice;
	private readonly textEl: HTMLElement;
	private cancelled = false;

	constructor() {
		this.notice = new Notice("", 0);
		const el = this.notice.messageEl;
		el.empty();
		this.textEl = el.createDiv();
		const button = el.createEl("button", { text: t("progress.cancel") });
		button.addEventListener("click", (event) => {
			event.stopPropagation(); // Notice はクリックで閉じるので、ボタンのクリックは伝えない
			this.cancelled = true;
			button.disabled = true;
			this.textEl.setText(t("progress.cancelling"));
		});
	}

	/** 中断ボタンが押されたか（次の 1 件を始める前に確かめる: D1）。 */
	isCancelled = (): boolean => this.cancelled;

	update(done: number, total: number, path: string): void {
		if (this.cancelled) return;
		this.textEl.setText(t("progress.message", { done: String(done + 1), total: String(total), path }));
	}

	hide(): void {
		this.notice.hide();
	}
}
