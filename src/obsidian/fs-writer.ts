// 書き込みの部品（09: ファイルの書き込み・R3・G4）。Node.js の fs を使う（デスクトップ専用: isDesktopOnly）。
// 一時ファイル（.{名前}.tmp）に書いてから rename で置き換える。一時ファイルは finally で必ず消す。
import { promises as fs } from "fs";
import * as nodePath from "path";
import { sha256Hex } from "../core/hash";
import type { OutputWriter } from "../core/mermaid-export";
import { isProtectedPath } from "../core/output-plan";
import type { FileResult, OutputRef } from "../core/types";

export interface OutputRoots {
	/** Vault の絶対パス */
	vaultBasePath: string;
	/** Vault 外の出力ルートの絶対パス（未設定なら空） */
	externalRoot: string;
}

export function absolutePath(ref: OutputRef, roots: OutputRoots): string {
	const root = ref.location === "vault" ? roots.vaultBasePath : roots.externalRoot;
	if (!root) throw new Error(`output root for ${ref.location} is not set`);
	return nodePath.join(root, ...ref.path.split("/"));
}

export class FsOutputWriter implements OutputWriter {
	constructor(
		private readonly roots: OutputRoots,
		/** 今回の変換元（Vault からの相対パス）。ここには書き込まない */
		private readonly sources: ReadonlySet<string>,
	) {}

	async exists(ref: OutputRef): Promise<boolean> {
		try {
			await fs.access(absolutePath(ref, this.roots));
			return true;
		} catch {
			return false;
		}
	}

	async write(ref: OutputRef, bytes: Uint8Array, signal: AbortSignal): Promise<Pick<FileResult, "status" | "reason" | "contentHash">> {
		if (isProtectedPath(ref, this.sources)) return { status: "failed", reason: "protected" };
		const target = absolutePath(ref, this.roots);
		const tmp = nodePath.join(nodePath.dirname(target), `.${nodePath.basename(target)}.tmp`);
		try {
			await fs.mkdir(nodePath.dirname(target), { recursive: true });
			await fs.writeFile(tmp, bytes);
			// タイムアウト後は置き換えない（D1・D2）
			if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
			await fs.rename(tmp, target);
			return { status: "success", contentHash: await sha256Hex(bytes) };
		} catch (error) {
			if (signal.aborted) throw error;
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "EBUSY" || code === "EPERM" || code === "EACCES") return { status: "skipped", reason: "inUse" };
			return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
		} finally {
			await fs.rm(tmp, { force: true }).catch(() => undefined);
		}
	}

	async hashOf(ref: OutputRef): Promise<string | null> {
		try {
			return await sha256Hex(await fs.readFile(absolutePath(ref, this.roots)));
		} catch {
			return null;
		}
	}

	async remove(ref: OutputRef): Promise<boolean> {
		if (isProtectedPath(ref, this.sources)) return false;
		try {
			await fs.unlink(absolutePath(ref, this.roots));
			return true;
		} catch {
			return false;
		}
	}
}

/** 文字列をアトミックに書き込む（マニフェストの保存用）。 */
export async function writeTextAtomic(target: string, text: string): Promise<void> {
	const tmp = nodePath.join(nodePath.dirname(target), `.${nodePath.basename(target)}.tmp`);
	try {
		await fs.mkdir(nodePath.dirname(target), { recursive: true });
		await fs.writeFile(tmp, text, "utf8");
		await fs.rename(tmp, target);
	} finally {
		await fs.rm(tmp, { force: true }).catch(() => undefined);
	}
}
