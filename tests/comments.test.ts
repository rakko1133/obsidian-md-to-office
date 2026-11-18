import { describe, expect, it } from "vitest";
import { stripComments } from "../src/core/comments";

describe("コメントの除去（A-16）", () => {
	it("インラインと複数行のコメントを消す", () => {
		expect(stripComments("a %%x%% b").text).toBe("a  b");
		expect(stripComments("a\n\n%%\n1\n\n2\n%%\n\nb").text).toBe("a\n\n\n\nb");
	});

	it("コードブロックとインラインコードの中は残す", () => {
		const md = "```mermaid\n%% c\n```\n`%%x%%` ``a `%%` b``";
		expect(stripComments(md).text).toBe(md);
	});

	it("閉じていない %% は最後までを消す", () => {
		expect(stripComments("a %% b\n\nc").text).toBe("a ");
	});

	it("印を残すと、コメントの中身と番号を返す", () => {
		const r = stripComments("a %% x %% b %%y%%", true);
		expect(r.text).toBe("a 0 b 1");
		expect(r.comments).toEqual(["x", "y"]);
	});
});
