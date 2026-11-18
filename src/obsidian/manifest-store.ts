// 出力マニフェストのファイルの読み書き（10・R3・D4）。形式と変換は src/core/manifest.ts。
// 置き場所: {Vault}/.obsidian/plugins/batch-office-export/export-record.json
import { promises as fs } from "fs";
import * as nodePath from "path";
import { MANIFEST_FILE_NAME, parseManifest, serializeManifest } from "../core/manifest";
import type { ManifestSnapshot, Warning } from "../core/types";
import { writeTextAtomic } from "./fs-writer";

export class ManifestStore {
	private readonly path: string;

	constructor(pluginDirAbsolute: string) {
		this.path = nodePath.join(pluginDirAbsolute, MANIFEST_FILE_NAME);
	}

	/** 実行の開始時に 1 回だけ読む。壊れていたら元のファイルを .broken として退避し、警告を返す。 */
	async load(): Promise<{ snapshot: ManifestSnapshot; warnings: Warning[] }> {
		let text: string | null = null;
		try {
			text = await fs.readFile(this.path, "utf8");
		} catch {
			text = null;
		}
		const parsed = parseManifest(text);
		const warnings: Warning[] = [];
		if (parsed.broken && text !== null) {
			await fs.copyFile(this.path, `${this.path}.broken`).catch(() => undefined);
			warnings.push({ code: "manifestBroken" });
		}
		return { snapshot: parsed.snapshot, warnings };
	}

	/** 実行の最後に 1 回だけ保存する。 */
	async save(snapshot: ManifestSnapshot): Promise<void> {
		await writeTextAtomic(this.path, serializeManifest(snapshot));
	}
}
