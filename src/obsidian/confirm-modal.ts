// 実行前の確認画面（02・R2・R3 のドライラン）。
// フォルダごとにまとめたチェックボックス付きの一覧を出し、ノートごとの出力パスと予定動作を表示する。
import { type App, Modal, Setting } from "obsidian";
import type { PlannedOutput } from "../core/docx-export";
import { OUTPUT_FORMATS, type OutputFormat } from "../core/settings";
import type { PlannedAction } from "../core/types";
import { dirName } from "../core/output-plan";
import { t } from "../i18n";

export interface ConfirmOptions {
	title: string;
	targets: readonly string[];
	excludedCount: number;
	outputLabel: string;
	/**
	 * ノート 1 件のドライラン（描画しない）。selectedCount はチェックが残っている件数。
	 * 出力の名前は実行する件数が 1 件かどうかで変わる（Excel: R8）ので、件数を渡す
	 */
	plan: (notePath: string, selectedCount: number) => Promise<PlannedOutput[]>;
	/** 出力形式を選べるようにする（Word / Excel / PDF の組み合わせ: R8・H1-PDF）。形式を変えると、題名と予定を計算し直す */
	formats?: {
		initial: readonly OutputFormat[];
		/** 結合出力のチェックボックスの初期値（C-8）。形式に Word か PDF があるときだけ出す */
		combine: boolean;
		title(formats: readonly OutputFormat[]): string;
		plan(formats: readonly OutputFormat[], combine: boolean, notePath: string, selectedCount: number): Promise<PlannedOutput[]>;
	};
}

export interface ConfirmResult {
	notes: string[];
	/** 選んだ出力形式（formats を渡したときだけ。1 つ以上） */
	formats?: OutputFormat[];
	/** 結合出力にするか（C-8） */
	combine?: boolean;
}

/** 確認画面を開き、実行するノートの一覧（と選んだ出力形式）を返す。キャンセルなら null。 */
export function confirmTargets(app: App, options: ConfirmOptions): Promise<ConfirmResult | null> {
	return new Promise((resolve) => new ConfirmModal(app, options, resolve).open());
}

class ConfirmModal extends Modal {
	private readonly checked: Set<string>;
	private readonly plans = new Map<string, PlannedOutput[]>();
	private resolved = false;
	private summaryEl!: HTMLElement;
	private totalsEl!: HTMLElement;
	private runButton: { setDisabled(disabled: boolean): unknown } | null = null;
	private readonly noteSummaryEls = new Map<string, HTMLElement>();
	private readonly noteDetailEls = new Map<string, HTMLElement>();
	private readonly checkboxes = new Map<string, HTMLInputElement>();
	private formats: OutputFormat[] | undefined;
	private combine = false;
	private combineSetting: Setting | null = null;
	/** 予定の計算の世代（形式を変えたら、古い計算の結果を捨てる） */
	private generation = 0;
	/** 今の予定を、チェックが 1 件だけの状態で計算したか（1 件かどうかが変わったら計算し直す: R8） */
	private plannedForSingle = false;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
		private readonly resolve: (value: ConfirmResult | null) => void,
	) {
		super(app);
		this.checked = new Set(options.targets);
		this.formats = options.formats ? [...options.formats.initial] : undefined;
		this.combine = options.formats?.combine ?? false;
	}

	/** 予定を計算し直す（形式・結合出力を変えたとき）。 */
	private replan(): void {
		this.plans.clear();
		this.totalsEl.setText(t("confirm.calculating"));
		for (const el of this.noteSummaryEls.values()) el.setText(`  ${t("confirm.calculating")}`);
		void this.computePlans();
	}

	override onOpen(): void {
		const { contentEl } = this;
		this.setTitle(this.formats && this.options.formats ? this.options.formats.title(this.formats) : this.options.title);
		contentEl.addClass("batch-office-export-confirm");

		const formats = this.options.formats;
		if (formats && this.formats) {
			// 形式ごとのチェックボックス（1 つ以上を選ぶ。全部外すと実行できない）
			const formatSetting = new Setting(contentEl).setName(t("confirm.format"));
			const boxes = formatSetting.controlEl.createDiv({ cls: "batch-office-export-formats" });
			for (const format of OUTPUT_FORMATS) {
				const label = boxes.createEl("label");
				const box = label.createEl("input", { type: "checkbox" });
				box.checked = this.formats.includes(format);
				label.createSpan({ text: ` ${t(`format.${format}`)}` });
				box.addEventListener("change", () => {
					const next = new Set(this.formats);
					if (box.checked) next.add(format);
					else next.delete(format);
					this.formats = OUTPUT_FORMATS.filter((f) => next.has(f));
					if (this.formats.length > 0) this.setTitle(formats.title(this.formats));
					this.combineSetting?.settingEl.toggle(this.combinable());
					this.updateSummary();
					if (this.formats.length > 0) this.replan();
				});
			}
			this.combineSetting = new Setting(contentEl).setName(t("confirm.combine")).addToggle((tg) =>
				tg.setValue(this.combine).onChange((v) => {
					this.combine = v;
					this.replan();
				}),
			);
			this.combineSetting.settingEl.toggle(this.combinable());
		}

		this.summaryEl = contentEl.createEl("p");
		contentEl.createEl("p", { text: t("confirm.output", { path: this.options.outputLabel }) });
		if (this.options.excludedCount > 0) contentEl.createEl("p", { text: t("confirm.excluded", { count: String(this.options.excludedCount) }) });
		this.totalsEl = contentEl.createEl("p", { text: t("confirm.calculating") });

		const list = contentEl.createDiv({ cls: "batch-office-export-tree" });
		for (const [folder, notes] of groupByFolder(this.options.targets)) this.renderFolder(list, folder, notes);

		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t("confirm.cancel")).onClick(() => this.close()))
			.addButton((b) => {
				this.runButton = b;
				b.setButtonText(t("confirm.run"))
					.setCta()
					.onClick(() =>
							this.finish({
								notes: [...this.options.targets].filter((p) => this.checked.has(p)),
								...(this.formats ? { formats: this.formats, combine: this.combine && this.combinable() } : {}),
							}),
						);
			});

		this.updateSummary();
		void this.computePlans();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolved = true;
			this.resolve(null);
		}
	}

	/** 結合出力を選べるか（Word か PDF を選んでいる）。 */
	private combinable(): boolean {
		return this.formats?.some((f) => f !== "excel") ?? false;
	}

	private finish(selected: ConfirmResult): void {
		this.resolved = true;
		this.resolve(selected);
		this.close();
	}

	private renderFolder(parent: HTMLElement, folder: string, notes: string[]): void {
		const folderEl = parent.createDiv({ cls: "batch-office-export-folder" });
		const header = folderEl.createEl("label");
		const folderBox = header.createEl("input", { type: "checkbox" });
		folderBox.checked = true;
		header.createSpan({ text: ` ${folder === "" ? "/" : folder}/ (${notes.length})` });
		folderBox.addEventListener("change", () => {
			for (const note of notes) {
				if (folderBox.checked) this.checked.add(note);
				else this.checked.delete(note);
				const box = this.checkboxes.get(note);
				if (box) box.checked = folderBox.checked;
			}
			this.updateSummary();
		});

		const ul = folderEl.createEl("ul");
		for (const note of notes) {
			const li = ul.createEl("li");
			const label = li.createEl("label");
			const box = label.createEl("input", { type: "checkbox" });
			box.checked = true;
			this.checkboxes.set(note, box);
			label.createSpan({ text: ` ${note.slice(note.lastIndexOf("/") + 1)}` });
			const summary = li.createSpan({ cls: "batch-office-export-note-summary", text: `  ${t("confirm.calculating")}` });
			this.noteSummaryEls.set(note, summary);
			const details = li.createEl("details");
			details.createEl("summary", { text: "…" });
			this.noteDetailEls.set(note, details);
			box.addEventListener("change", () => {
				if (box.checked) this.checked.add(note);
				else this.checked.delete(note);
				this.updateSummary();
			});
		}
	}

	private updateSummary(): void {
		// 実行する件数が 1 件かどうかで出力の名前が変わる（Excel の {ノート名}.xlsx / {フォルダ名}.xlsx: R8）
		if (this.checked.size > 0 && (this.checked.size === 1) !== this.plannedForSingle && (this.formats?.length ?? 1) > 0) {
			this.replan();
		}
		this.summaryEl.setText(t("confirm.summary", { selected: String(this.checked.size), total: String(this.options.targets.length) }));
		this.runButton?.setDisabled(this.checked.size === 0 || this.formats?.length === 0);
		this.updateTotals();
	}

	private updateTotals(): void {
		if (this.plans.size < this.options.targets.length) return;
		const planned = [...this.plans].filter(([note]) => this.checked.has(note)).flatMap(([, plans]) => plans);
		// 束ねた出力（1 フォルダ = 1 ブック）は、複数のノートが同じ出力を予定するので、出力ごとに 1 回だけ数える
		const all = [...new Map(planned.map((p) => [`${p.output.location}:${p.output.path}`, p])).values()];
		this.totalsEl.setText(t("confirm.totals", { summary: actionSummary(all) || "0" }));
	}

	/** ノートごとにドライランを計算して表示する。1 件ごとに制御を返して画面を固めない。 */
	private async computePlans(): Promise<void> {
		const generation = ++this.generation;
		const chosen = this.formats ? [...this.formats] : undefined;
		const combine = this.combine && this.combinable();
		const formats = this.options.formats;
		const selectedCount = this.checked.size;
		this.plannedForSingle = selectedCount === 1;
		for (const note of this.options.targets) {
			if (this.resolved || generation !== this.generation) return;
			let plans: PlannedOutput[] = [];
			try {
				plans = formats && chosen ? await formats.plan(chosen, combine, note, selectedCount) : await this.options.plan(note, selectedCount);
			} catch {
				plans = [];
			}
			if (generation !== this.generation) return;
			this.plans.set(note, plans);
			this.noteSummaryEls.get(note)?.setText(`  ${actionSummary(plans) || t("confirm.noOutputs")}`);
			const details = this.noteDetailEls.get(note);
			if (details) {
				details.empty();
				details.createEl("summary", { text: String(plans.length) });
				const ul = details.createEl("ul");
				for (const p of plans) ul.createEl("li", { text: `${t(`action.${p.action}`)}: ${p.output.path}` });
				if (plans.length === 0) details.hide();
			}
			await new Promise((r) => window.setTimeout(r, 0));
		}
		this.updateTotals();
	}
}

function groupByFolder(paths: readonly string[]): Map<string, string[]> {
	const map = new Map<string, string[]>();
	for (const p of paths) {
		const folder = dirName(p);
		map.set(folder, [...(map.get(folder) ?? []), p]);
	}
	return map;
}

const ACTION_ORDER: readonly PlannedAction[] = ["create", "overwrite", "unchanged", "rename", "skip"];

/** 予定動作ごとの件数の要約（例: 「新規 2 · 変更なし 1」）。 */
function actionSummary(plans: readonly PlannedOutput[]): string {
	return ACTION_ORDER.map((a) => [a, plans.filter((p) => p.action === a).length] as const)
		.filter(([, n]) => n > 0)
		.map(([a, n]) => `${t(`action.${a}`)} ${n}`)
		.join(" · ");
}
