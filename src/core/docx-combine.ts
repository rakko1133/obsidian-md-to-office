// 結合出力（C-8・フェーズ 5a）。Obsidian API に依存しない。
// 1 フォルダ = 1 つの .docx。ノートごとに組み立て（prepareDocxNote）、全ノートの処理の後に章として並べて 1 つの文書の木にまとめ、
// renderDocx に 1 回渡す。まとめるときに、脚注・ブックマーク・コメント・Mermaid の図の連番を章ごとに付け直す。
import type { PhrasingContent, Root, RootContent } from "mdast";
import { pageDecorations, prepareDocxNote, styleOptions, writeWithConflictPolicy, type DocxExportDeps, type PlannedOutput } from "./docx-export";
import { renderDocx, type DiagramAsset } from "./docx-render";
import { mapFrontmatter, valueToText } from "./frontmatter";
import { baseName, dirName, joinPath, noteBaseName, outputDirFor, plannedAction, refKey, relativeUrl } from "./output-plan";
import { aggregateStatus } from "./run";
import type { PluginSettings } from "./settings";
import type { FileResult, ManifestSnapshot, NoteResult, OutputRef } from "./types";

/** 章へのリンクを「まとめるときに決める」ための URL の形 */
export const CHAPTER_LINK_SCHEME = "boe-chapter:";
/** Word のブックマーク名の上限 */
const BOOKMARK_MAX = 40;

/** 章 1 つ（ノート 1 件を組み立てたもの）。 */
export interface Chapter {
	notePath: string;
	/** 章の見出し（frontmatter の title、なければノート名） */
	title: string;
	tree: Root;
	/** 元の Markdown（未対応の記法を原文で残すため） */
	source: string;
	comments: string[];
	diagrams: Map<number, DiagramAsset>;
	/** frontmatter の order（並び順: C-8） */
	order?: number;
}

/** 結合出力の出力先（1 フォルダ = 1 つの .docx / .pdf: R8・C-8・H1-PDF）。 */
export function combinedOutputRef(
	notePath: string,
	settings: Pick<PluginSettings, "saveMode" | "outputLocation" | "outputRoot">,
	vaultName: string,
	extension: "docx" | "pdf" = "docx",
): OutputRef {
	const dir = outputDirFor(notePath, settings);
	const folder = dirName(notePath);
	return { location: dir.location, path: joinPath(dir.path, `${folder === "" ? vaultName || "Vault" : baseName(folder)}.${extension}`) };
}

/** フォルダの MOC（フォルダと同じ名前のノート。Vault 直下は Vault と同じ名前）のパス。 */
export function mocPathOf(notePath: string, vaultName: string): string {
	const folder = dirName(notePath);
	return joinPath(folder, `${folder === "" ? vaultName : baseName(folder)}.md`);
}

/** MOC の本文から、リンク先を出現順に取り出す（Wikilink・埋め込み・Markdown のリンク）。解決できないものは除く。 */
export function mocLinks(markdown: string, mocPath: string, resolve: (link: string, source: string) => string | null): string[] {
	const out: string[] = [];
	const pattern = /!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]|\[[^\]]*\]\(([^)\s]+?)(?:#[^)\s]*)?(?:\s+"[^"]*")?\)/g;
	for (const m of markdown.matchAll(pattern)) {
		const raw = (m[1] ?? decodeURIComponent(m[2] ?? "")).trim();
		if (raw === "" || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
		const path = resolve(raw, mocPath);
		if (path && !out.includes(path)) out.push(path);
	}
	return out;
}

/** 章の並び順（C-8）。 */
export function orderChapters<T extends { notePath: string; order?: number }>(chapters: readonly T[], order: PluginSettings["combineOrder"], moc: readonly string[] = []): T[] {
	const byName = (a: T, b: T) => noteBaseName(a.notePath).localeCompare(noteBaseName(b.notePath), "ja") || a.notePath.localeCompare(b.notePath);
	const sorted = [...chapters].sort(byName);
	if (order === "frontmatterOrder") {
		const has = (c: T) => c.order !== undefined && Number.isFinite(c.order);
		return [...sorted.filter(has).sort((a, b) => a.order! - b.order! || byName(a, b)), ...sorted.filter((c) => !has(c))];
	}
	if (order === "moc") {
		const rank = (c: T) => {
			const i = moc.indexOf(c.notePath);
			return i < 0 ? Number.MAX_SAFE_INTEGER : i;
		};
		return [...sorted].sort((a, b) => rank(a) - rank(b) || byName(a, b));
	}
	return sorted;
}

type AnyNode = Root | RootContent;

/** 子を持つノードの子の配列。 */
function childrenOf(node: AnyNode): AnyNode[] | undefined {
	return "children" in node && Array.isArray(node.children) ? (node.children) : undefined;
}

/**
 * 章を並べて 1 つの文書の木にまとめる（C-8）。各章の先頭に章の見出し（見出し 1・ブックマーク付き）を置き、
 * ノートの見出しは 1 段下げる。2 章目からは前に改ページを入れる（C-2）。脚注・ブックマーク・コメント・図の連番は章ごとに付け直す。
 * 章へのリンク（CHAPTER_LINK_SCHEME）は、同じ文書にある章なら章の先頭へのリンク、なければ文字だけにする。
 */
export function combineChapters(chapters: readonly Chapter[]): { tree: Root; comments: string[]; diagrams: Map<number, DiagramAsset> } {
	const children: RootContent[] = [];
	const comments: string[] = [];
	const diagrams = new Map<number, DiagramAsset>();
	const chapterAnchor = new Map<string, string>();
	let diagramOffset = 0;

	chapters.forEach((chapter, i) => {
		const prefix = `c${i + 1}`;
		const rename = (name: string) => `${prefix}_${name}`.slice(0, BOOKMARK_MAX);
		const commentOffset = comments.length;
		let maxDiagram = -1;
		const visit = (node: AnyNode): void => {
			const n = node as RootContent & { data?: Record<string, unknown> };
			// 未対応の記法を原文で残すとき、どの章の原文かが分かるように、原文をノードに持たせる（docx-render の sourceOf）
			const start = n.position?.start.offset;
			const end = n.position?.end.offset;
			if (start !== undefined && end !== undefined && n.data?.original === undefined) n.data = { ...n.data, original: chapter.source.slice(start, end) };
			switch (n.type) {
				case "footnoteReference":
				case "footnoteDefinition":
					n.identifier = `${prefix}:${n.identifier}`;
					break;
				case "internalLink":
					n.anchor = rename(n.anchor);
					break;
				case "commentMark":
					n.id += commentOffset;
					break;
				case "heading":
					n.depth = Math.min(n.depth + 1, 6) as typeof n.depth;
					break;
				case "code":
					if (typeof n.data?.mermaidIndex === "number") {
						maxDiagram = Math.max(maxDiagram, n.data.mermaidIndex);
						n.data = { ...n.data, mermaidIndex: n.data.mermaidIndex + diagramOffset };
					}
					break;
			}
			if (typeof n.data?.bookmark === "string") n.data = { ...n.data, bookmark: rename(n.data.bookmark) };
			for (const child of childrenOf(node) ?? []) visit(child);
		};
		visit(chapter.tree);
		for (const [index, asset] of chapter.diagrams) {
			diagrams.set(index + diagramOffset, asset);
			maxDiagram = Math.max(maxDiagram, index);
		}
		diagramOffset += maxDiagram + 1;
		comments.push(...chapter.comments);

		const anchor = rename("ch");
		chapterAnchor.set(chapter.notePath, anchor);
		if (i > 0) children.push({ type: "pageBreak" });
		children.push({ type: "heading", depth: 1, children: [{ type: "text", value: chapter.title }], data: { bookmark: anchor } });
		children.push(...chapter.tree.children);
	});

	// 章へのリンクを付け替える
	const relink = (nodes: AnyNode[]): void => {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (node.type === "link" && node.url.startsWith(CHAPTER_LINK_SCHEME)) {
				const anchor = chapterAnchor.get(node.url.slice(CHAPTER_LINK_SCHEME.length));
				const link = node;
				const replacement: PhrasingContent[] = anchor !== undefined ? [{ type: "internalLink", anchor, children: link.children }] : link.children;
				nodes.splice(i, 1, ...(replacement as AnyNode[]));
				i += replacement.length - 1;
				continue;
			}
			const kids = childrenOf(node);
			if (kids) relink(kids);
		}
	};
	const tree: Root = { type: "root", children };
	relink(tree.children);
	return { tree, comments, diagrams };
}

interface Group {
	output: OutputRef;
	folderName: string;
	chapters: Chapter[];
	/** MOC のパス（並び順が MOC のときは章にしない） */
	moc?: string;
	contributors: string[];
}

export interface CombineRunDeps extends DocxExportDeps {
	tocLabel?: string;
}

/** 1 回の実行の中で、結合出力の文書（フォルダ）ごとの章を持つ。 */
export class DocxCombineRun {
	private readonly groups = new Map<string, Group>();
	private readonly converted: Set<string>;

	constructor(
		private readonly settings: PluginSettings,
		/** 今回の実行の対象（確認画面で選んだノート） */
		private readonly selected: readonly string[],
		manifest: ManifestSnapshot,
		private readonly deps: CombineRunDeps,
	) {
		this.converted = new Set(selected);
		for (const entry of manifest.entries) if (entry.kind === "docx") for (const source of entry.sources) this.converted.add(source);
	}

	private get vaultName(): string {
		return this.deps.vault?.vaultName ?? "";
	}

	outputOf(notePath: string): OutputRef {
		return combinedOutputRef(notePath, this.settings, this.vaultName);
	}

	private groupOf(notePath: string): Group {
		const output = this.outputOf(notePath);
		const key = refKey(output);
		let group = this.groups.get(key);
		if (!group) {
			const folder = dirName(notePath);
			group = { output, folderName: folder === "" ? this.vaultName || "Vault" : baseName(folder), chapters: [], contributors: [] };
			this.groups.set(key, group);
		}
		return group;
	}

	/** ノート 1 件を章として組み立てて、文書に足す（書き込みは finish）。 */
	async addNote(notePath: string, signal: AbortSignal): Promise<NoteResult> {
		const group = this.groupOf(notePath);
		const ownKey = refKey(group.output);
		const isMoc = this.settings.combineOrder === "moc" && notePath === mocPathOf(notePath, this.vaultName);
		if (isMoc) {
			group.moc = notePath;
			group.contributors.push(notePath);
			return { notePath, status: "success", files: [], warnings: [], deleted: [] };
		}
		const prepared = await prepareDocxNote(notePath, signal, this.settings, this.deps, {
			isConverted: (path) => this.converted.has(path),
			// 同じ文書に入るノートは章へのリンク（まとめるときに決める）、別の文書に入るノートはその .docx への相対リンク（C-8）
			docxLink: (target) => {
				const targetOutput = this.selected.includes(target) ? this.outputOf(target) : null;
				if (targetOutput && refKey(targetOutput) === ownKey) return `${CHAPTER_LINK_SCHEME}${target}`;
				return relativeUrl(group.output, targetOutput ?? { location: group.output.location, path: joinPath(outputDirFor(target, this.settings).path, `${noteBaseName(target)}.docx`) });
			},
		});
		// タイムアウトしたノートは章にしない（D1・D2）
		if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
		const order = Number(valueToText(prepared.rawFrontmatter?.order));
		group.chapters.push({
			notePath,
			title: prepared.fm.title ?? noteBaseName(notePath),
			tree: prepared.assembled.tree,
			source: prepared.assembled.source,
			comments: prepared.assembled.comments,
			diagrams: prepared.diagrams,
			...(valueToText(prepared.rawFrontmatter?.order) !== "" && Number.isFinite(order) ? { order } : {}),
		});
		group.contributors.push(notePath);
		return { notePath, status: "success", files: [], warnings: prepared.warnings, deleted: [] };
	}

	/** 文書ごとに章を並べてまとめ、書き込み、結果を章のノートに付ける（中断・fail-fast でも処理済みの章で作る）。 */
	async finish(results: NoteResult[]): Promise<void> {
		const signal = new AbortController().signal;
		for (const group of this.groups.values()) {
			if (group.chapters.length === 0) continue;
			let file: FileResult;
			try {
				let moc: string[] = [];
				let mocFm: Readonly<Record<string, unknown>> | undefined;
				if (group.moc) {
					moc = mocLinks(await this.deps.readNote(group.moc), group.moc, (link, source) => this.deps.vault?.resolveLink(link, source) ?? null);
					mocFm = this.deps.vault?.frontmatter?.(group.moc);
				}
				const ordered = orderChapters(group.chapters, this.settings.combineOrder, moc);
				const { tree, comments, diagrams } = combineChapters(ordered);
				const fm = mapFrontmatter(mocFm);
				const title = fm.title ?? group.folderName;
				const creator = fm.author ?? this.settings.authorName;
				const bytes = new Uint8Array(
					await renderDocx(tree, {
						title,
						creator,
						strictLineBreaks: this.deps.strictLineBreaks ?? this.settings.strictLineBreaksFallback,
						fileNameAsTitle: false,
						page: { paperSize: this.settings.paperSize, orientation: this.settings.orientation, marginsMm: this.settings.marginsMm },
						fonts: {
							bodyEastAsia: this.settings.bodyFontEastAsia,
							bodyLatin: this.settings.bodyFontLatin,
							headingEastAsia: this.settings.headingFontEastAsia,
							headingLatin: this.settings.headingFontLatin,
						},
						diagrams,
						source: "",
						codeLineNumbers: this.settings.codeLineNumbers,
						comments,
						properties: fm.properties,
						...pageDecorations(this.settings, { title, author: creator, date: valueToText(mocFm?.date), combined: true }, this.deps.tocLabel),
						...styleOptions(this.settings, this.deps),
					}),
				);
				file = await writeWithConflictPolicy(group.output, bytes, this.settings.onConflict, this.deps, signal, "docx");
			} catch (error) {
				file = { output: group.output, kind: "docx", status: "failed", reason: error instanceof Error ? error.message : String(error) };
			}
			for (const result of results) {
				if (!group.contributors.includes(result.notePath) || result.status === "failed") continue;
				result.files.push(file);
				result.status = aggregateStatus(result.files);
				if (file.status === "failed" && file.reason) result.reason = file.reason;
			}
		}
	}
}

/** ドライラン: 結合出力の .docx の出力先と予定動作。 */
export async function planCombinedNote(notePath: string, settings: PluginSettings, vaultName: string, exists: (ref: OutputRef) => Promise<boolean>): Promise<PlannedOutput[]> {
	const output = combinedOutputRef(notePath, settings, vaultName);
	return [{ output, action: plannedAction(await exists(output), false, settings.onConflict) }];
}
