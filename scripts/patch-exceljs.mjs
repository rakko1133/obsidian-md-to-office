// exceljs のブラウザ向けビルド（dist/exceljs.min.js）に同梱された setImmediate の代替実装から、
// 古い IE 向けの経路（<script> 要素の onreadystatechange）と、文字列のコールバックを new Function で関数にする経路を取り除く esbuild のプラグイン。
// Electron では MessageChannel の経路が使われるため、どちらも実行されない。コミュニティプラグインの自動レビューは
// 「実行時に script 要素を作る」「new Function を使う」を静的に検出するので、配布物から消す（1.0.2）。
import { readFile } from "node:fs/promises";

const PATCHES = [
	// "document"in e&&"onreadystatechange"in e.document.createElement("script") → 偽
	[/"document"in (\w+)&&"onreadystatechange"in \1\.document\.createElement\("script"\)/g, "!1"],
	// u&&"onreadystatechange"in u.createElement("script") → 偽
	[/(\w+)&&"onreadystatechange"in \1\.createElement\("script"\)/g, "!1"],
	// "function"!=typeof e&&(e=new Function(""+e)) → 関数でなければ例外
	[/"function"!=typeof (\w+)&&\(\1=new Function\(""\+\1\)\)/g, '"function"!=typeof $1&&(()=>{throw new TypeError("callback must be a function")})()'],
];
const EXPECTED = 3;

export const patchExceljs = {
	name: "patch-exceljs",
	setup(build) {
		// filter は esbuild（Go の正規表現）で評価される。パス区切りは Windows と他で違うので「.」で受ける
		build.onLoad({ filter: /exceljs.dist.exceljs\.min\.js$/ }, async (args) => {
			let source = await readFile(args.path, "utf8");
			let count = 0;
			for (const [pattern, replacement] of PATCHES) {
				source = source.replace(pattern, (...m) => {
					count++;
					return replacement.replace(/\$1/g, m[1]);
				});
			}
			// exceljs を上げて形が変わったら、黙って通さずにビルドを止める
			if (count !== EXPECTED) throw new Error(`patch-exceljs: expected ${EXPECTED} replacements, got ${count}. Check node_modules/exceljs/dist/exceljs.min.js`);
			return { contents: source, loader: "js" };
		});
	},
};
