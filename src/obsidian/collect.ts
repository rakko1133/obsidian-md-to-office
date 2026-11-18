// 変換対象の候補を集める（01: 変換対象の収集・R2）。絞り込みは src/core/targets.ts。
import { type App, TFile, TFolder, Vault, type TAbstractFile } from "obsidian";
import type { TargetCandidate } from "../core/types";

/** 起動のきっかけ（R2 の 4 つの起動方法）。 */
export type TargetSource =
	| { kind: "items"; items: readonly TAbstractFile[] } // ファイル・フォルダ・複数選択の右クリック
	| { kind: "active" } // コマンド「現在のノート」
	| { kind: "vault" }; // コマンド「Vault 全体」

/** 候補を集める。直接選んだファイルは explicit、フォルダや Vault 全体から展開したノートは explicit でない。 */
export function collectCandidates(app: App, source: TargetSource): TargetCandidate[] {
	const out: TargetCandidate[] = [];
	const add = (file: TFile, explicit: boolean): void => {
		out.push({ path: file.path, explicit, frontmatterExport: app.metadataCache.getFileCache(file)?.frontmatter?.export });
	};

	switch (source.kind) {
		case "active": {
			const file = app.workspace.getActiveFile();
			if (file) add(file, true);
			break;
		}
		case "vault":
			for (const file of app.vault.getMarkdownFiles()) add(file, false);
			break;
		case "items":
			for (const item of source.items) {
				if (item instanceof TFile) {
					add(item, true);
				} else if (item instanceof TFolder) {
					Vault.recurseChildren(item, (child) => {
						if (child instanceof TFile && child.extension === "md") add(child, false);
					});
				}
			}
			break;
	}
	return out;
}

/** 右クリックのメニューに「Mermaid 画像として保存」を出すか。.md ファイルかフォルダが 1 つでも含まれていれば出す。 */
export function hasConvertibleItem(items: readonly TAbstractFile[]): boolean {
	return items.some((item) => item instanceof TFolder || (item instanceof TFile && item.extension === "md"));
}
