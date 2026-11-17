// esbuild の設定。
//   node esbuild.config.mjs             開発ビルドを監視して作り直す
//   node esbuild.config.mjs once        開発ビルドを 1 回だけ作る
//   node esbuild.config.mjs production  本番ビルドを 1 回だけ作る
import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { statSync } from "node:fs";

const mode = process.argv[2];
const prod = mode === "production";
const once = prod || mode === "once";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	// Obsidian が実行時に提供するモジュールと Node.js の組み込みモジュールはバンドルしない
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: "cjs",
	// platform は既定の browser。exceljs は package.json の browser フィールドでブラウザ向けのビルドが選ばれる
	target: "es2018",
	define: {
		// 開発用のコマンドは開発ビルドにだけ入れる（本番ビルドでは条件ごと削除される）
		__DEV__: JSON.stringify(!prod),
	},
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
});

if (once) {
	await context.rebuild();
	await context.dispose();
	const bytes = statSync("main.js").size;
	console.log(`main.js: ${bytes.toLocaleString()} bytes (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
} else {
	await context.watch();
}
