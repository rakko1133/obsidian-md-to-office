// 配布物（本番ビルドの main.js）に入る npm パッケージのライセンス文を THIRD_PARTY_NOTICES.md にまとめる（G1）。
//   node scripts/third-party-notices.mjs          THIRD_PARTY_NOTICES.md を書き直す
//   node scripts/third-party-notices.mjs --check  内容が古ければ終了コード 1（ファイルは書かない）
// esbuild の metafile で、出力に 1 バイト以上入ったファイルの属するパッケージだけを数える。
import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = "THIRD_PARTY_NOTICES.md";

const result = await esbuild.build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	write: false,
	metafile: true,
	format: "cjs",
	target: "es2018",
	minify: true,
	treeShaking: true,
	define: { __DEV__: "false" },
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
	outfile: "main.js",
	logLevel: "silent",
});

// パッケージのフォルダ（node_modules/a/node_modules/b のような入れ子も区別する）→ 出力のバイト数
const bytes = new Map();
for (const output of Object.values(result.metafile.outputs)) {
	for (const [file, info] of Object.entries(output.inputs)) {
		if (info.bytesInOutput === 0) continue;
		const match = file.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
		if (!match) continue;
		bytes.set(match[1], (bytes.get(match[1]) ?? 0) + info.bytesInOutput);
	}
}

// docx と exceljs は配布ビルドの中に自分の依存を埋め込んでいる（metafile には出てこない）。
// docx: dist/index.mjs の `// node_modules/...` の注記で確認した分。exceljs: browserify のビルドで中身を辿れないので、実行時の依存をすべて載せる
const EMBEDDED = {
	docx: ["nanoid"],
	exceljs: Object.keys(JSON.parse(readFileSync("node_modules/exceljs/package.json", "utf8")).dependencies ?? {}),
};

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\..*)?$/i;
function describe(dir, embeddedIn) {
	const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const raw = pkg.license ?? pkg.licenses;
	const license = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map((l) => l.type ?? l).join(" OR ") : raw?.type ?? "(none)";
	const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
	const texts = files.map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim());
	// ライセンスファイルを同梱していないパッケージは、package.json の author でライセンスの定型の本文を補う
	const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
	if (texts.length === 0 && STANDARD_TEXT[license]) texts.push(STANDARD_TEXT[license]((author ?? pkg.name).replace(/\s*[<(][^>)]*[>)]/g, "")));
	if (texts.length === 0) throw new Error(`${pkg.name}@${pkg.version}: no license file and no standard text for ${license}`);
	const repo = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? "";
	return { name: pkg.name, version: pkg.version, license, texts, embeddedIn, generated: files.length === 0, repo: repo.replace(/^git\+/, "").replace(/\.git$/, "") };
}
const STANDARD_TEXT = {
	MIT: (holder) => `MIT License\n\nCopyright (c) ${holder}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
	ISC: (holder) => `ISC License

Copyright (c) ${holder}

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
};

const packages = [...bytes.keys()].map((dir) => describe(dir));
for (const [host, names] of Object.entries(EMBEDDED)) {
	for (const name of names) {
		const dir = [`node_modules/${host}/node_modules/${name}`, `node_modules/${name}`].find((d) => existsSync(join(d, "package.json")));
		if (!dir) throw new Error(`${name} (embedded in ${host}) is not installed`);
		if (!packages.some((p) => p.name === name)) packages.push(describe(dir, host));
	}
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const missing = packages.filter((p) => p.generated);
const lines = [
	"# Third-party notices",
	"",
	"`main.js` of Batch Office Export bundles the following npm packages.",
	"Their license texts are reproduced below as their licenses require.",
	"This file is generated by `node scripts/third-party-notices.mjs`; do not edit it by hand.",
	"",
	"Packages marked \"embedded in\" are not bundled directly but are included in the prebuilt distribution of the named package.",
	"",
	"| Package | Version | License | Note |",
	"|---|---|---|---|",
	...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license} | ${p.embeddedIn ? `embedded in ${p.embeddedIn}` : ""} |`),
	"",
	"`jszip` is dual-licensed; it is used under the MIT license. `docx` 9.15.4 also embeds small runtime helpers from `@oxc-project/runtime` (MIT, https://github.com/oxc-project/oxc).",
	"",
];
for (const p of packages) {
	lines.push("---", "", `## ${p.name} ${p.version}`, "", `License: ${p.license}${p.repo ? `  \nRepository: ${p.repo}` : ""}`, "");
	if (p.generated) lines.push("(The package ships no license file. The text below is the standard text of the license named in its package.json.)", "");
	for (const text of p.texts) lines.push("```text", text, "```", "");
}
const content = lines.join("\n");

if (process.argv.includes("--check")) {
	const current = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
	if (current !== content) {
		console.error(`${OUT} is out of date. Run: node scripts/third-party-notices.mjs`);
		process.exit(1);
	}
	console.log(`${OUT} is up to date (${packages.length} packages).`);
} else {
	writeFileSync(OUT, content);
	console.log(`${OUT}: ${packages.length} packages`);
}
if (missing.length) console.warn(`No license file (standard text used): ${missing.map((p) => `${p.name}@${p.version}`).join(", ")}`);
