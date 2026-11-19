// 開発用の自動実行で、設定画面を確かめる（開発ビルドだけ: dev-automation.ts から呼ぶ）。
// 設定画面を開き、行ごとの名前・説明・入力欄の値を書き出す。操作（actions）があれば、入力欄に値を入れて
// 保存された設定と画面の変化を記録する。最後に設定を元に戻し、設定画面を閉じる。
import type { PluginSettings } from "../core/settings";
import type BatchOfficeExportPlugin from "../main";

export interface SettingAction {
	/** 行の名前（画面の表示どおり） */
	row: string;
	/** 同じ名前の行が複数あるとき、何番目か（0 から）。既定 0 */
	nth?: number;
	/** 行の中の入力欄の番号（0 から）。既定 0 */
	control?: number;
	/** トグルは true / false、それ以外は文字列 */
	value: string | boolean;
}

interface SettingModal {
	open(): void;
	close(): void;
	openTabById(id: string): unknown;
	activeTab: { containerEl: HTMLElement; settingItems?: unknown[] } | null;
}

interface RowDump {
	name: string;
	desc: string;
	shown: boolean;
	controls: (string | boolean)[];
}

const SETTLE_MS = 300;

export async function inspectSettingTab(plugin: BatchOfficeExportPlugin, actions: readonly SettingAction[]): Promise<Record<string, unknown>> {
	const modal = (plugin.app as unknown as { setting: SettingModal }).setting;
	const original: PluginSettings = structuredClone(plugin.settings);
	modal.open();
	modal.openTabById(plugin.manifest.id);
	try {
		await sleep(SETTLE_MS);
		const tab = modal.activeTab;
		if (!tab) return { error: "the settings tab did not open" };
		const before = dumpRows(tab.containerEl);
		const steps: Record<string, unknown>[] = [];
		for (const action of actions) {
			const error = applyAction(tab.containerEl, action);
			await sleep(SETTLE_MS);
			steps.push({ action, ...(error ? { error } : {}), settings: structuredClone(plugin.settings), rows: dumpRows(tab.containerEl).filter((r) => r.shown).map((r) => r.name) });
		}
		return {
			headings: Array.from(tab.containerEl.querySelectorAll("[class*='heading']")).map((el) => el.textContent?.trim() ?? "").filter((text) => text !== ""),
			settingItems: tab.settingItems?.length ?? null,
			rows: before,
			steps,
		};
	} finally {
		plugin.settings = original;
		await plugin.saveSettings();
		modal.close();
	}
}

function settingRows(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(".setting-item")).filter((el) => !el.classList.contains("setting-item-heading"));
}

/** 行の中の入力欄（トグルは .checkbox-container を 1 つと数える） */
function controlsOf(row: HTMLElement): HTMLElement[] {
	return Array.from(row.querySelectorAll<HTMLElement>(".setting-item-control input, .setting-item-control select, .setting-item-control textarea, .setting-item-control .checkbox-container")).filter(
		(el) => !el.closest(".checkbox-container") || el.classList.contains("checkbox-container"),
	);
}

function valueOf(el: HTMLElement): string | boolean {
	if (el.classList.contains("checkbox-container")) return el.classList.contains("is-enabled");
	if (el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLSelectElement) || el.instanceOf(HTMLTextAreaElement)) return el.value;
	return el.textContent ?? "";
}

function dumpRows(container: HTMLElement): RowDump[] {
	return settingRows(container).map((row) => ({
		name: row.querySelector(".setting-item-name")?.textContent?.trim() ?? "",
		desc: row.querySelector(".setting-item-description")?.textContent?.trim() ?? "",
		shown: row.isShown(),
		controls: controlsOf(row).map(valueOf),
	}));
}

function applyAction(container: HTMLElement, action: SettingAction): string | undefined {
	const rows = settingRows(container).filter((row) => row.querySelector(".setting-item-name")?.textContent?.trim() === action.row);
	const row = rows[action.nth ?? 0];
	if (!row) return `row not found: ${action.row}`;
	const el = controlsOf(row)[action.control ?? 0];
	if (!el) return `control not found: ${action.control ?? 0}`;
	if (el.classList.contains("checkbox-container")) {
		if (el.classList.contains("is-enabled") !== action.value) el.click();
		return undefined;
	}
	if (el.instanceOf(HTMLInputElement) || el.instanceOf(HTMLSelectElement) || el.instanceOf(HTMLTextAreaElement)) {
		el.value = String(action.value);
		el.dispatchEvent(new Event("input", { bubbles: true }));
		el.dispatchEvent(new Event("change", { bubbles: true }));
		// 入力欄から離れたときに値を確定する入力欄もある（数値の入力欄など）
		el.dispatchEvent(new FocusEvent("blur"));
		el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
		return undefined;
	}
	return "unsupported control";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
