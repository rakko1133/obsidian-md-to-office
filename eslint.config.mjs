// ESLint の設定。Obsidian 公式の eslint-plugin-obsidianmd の推奨設定（コミュニティプラグインの自動レビューと同じ観点）で src/ を検査する（G1）。
//   npm run lint
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	// ビルド結果・Node.js で動かすスクリプト・テスト・テスト用 Vault はプラグインのコードではない
	globalIgnores(["node_modules", "main.js", "*.mjs", "scripts/**", "tests/**", "test-vault/**", "vitest.config.ts", ".preview/**"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
]);
