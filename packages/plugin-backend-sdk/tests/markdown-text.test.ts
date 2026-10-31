import { escapeMarkdownText } from "@ryot-app/plugin-backend-sdk/markdown-text";
import { expect, test } from "vitest";

test("escapes literal punctuation, indentation, and line breaks without runtime dependencies", () => {
	expect(
		escapeMarkdownText(
			"    # title\n* bullet\n1. ordered\n\n:spoiler[secret] &amp; <b>literal</b>\\end",
		),
	).toBe(
		"&#32;&#32;&#32;&#32;\\# title\\\n\\* bullet\\\n1\\. ordered\n\n\\:spoiler\\[secret\\] \\&amp\\; \\<b\\>literal\\<\\/b\\>\\\\end",
	);
	expect(escapeMarkdownText("\tindent\r\nnext\r\n\r\nlast")).toBe("&#9;indent\\\nnext\n\nlast");
	expect(escapeMarkdownText("Trailing  \nnext")).toBe("Trailing&#32;&#32;\\\nnext");
	expect(escapeMarkdownText("")).toBe("");
});
