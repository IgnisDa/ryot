import { normalizeMarkdown } from "@ryot-app/plugin-backend-sdk/markdown";
import { escapeMarkdownText } from "@ryot-app/plugin-backend-sdk/markdown-text";
import type { Nodes } from "mdast";
import { directiveFromMarkdown } from "mdast-util-directive";
import { fromMarkdown } from "mdast-util-from-markdown";
import { directive } from "micromark-extension-directive";
import { expect, test } from "vitest";

const visibleText = (node: Nodes): string => {
	if (
		(node.type === "textDirective" || node.type === "containerDirective") &&
		node.name === "spoiler"
	) {
		return "";
	}
	if (node.type === "text") {
		return node.value;
	}
	return "children" in node ? node.children.map(visibleText).join("") : "";
};

test("normalizes supported Markdown and mixed HTML to restricted canonical Markdown", () => {
	expect(
		normalizeMarkdown(
			"# Title\n\nA **bold** and <em>soft</em> word.<br>Next.\n\n> Quote\n\n* First\n* Second",
		),
	).toBe("**Title**\n\nA **bold** and *soft* word.\\\nNext.\n\n> Quote\n\n- First\n- Second");
	expect(
		normalizeMarkdown(
			"<h2>Title</h2><p><strong>Bold</strong> and <u>underlined</u> <del>deleted</del>.</p>",
		),
	).toBe("**Title**\n\n**Bold** and underlined deleted.");
	expect(normalizeMarkdown("1. First\n2. Second")).toBe("1. First\n2. Second");
});

test("keeps nested spoiler directives and drops authored attributes and unknown directive wrappers", () => {
	expect(
		normalizeMarkdown("Before :spoiler[**secret** :spoiler[inner]]{#id title=ignored} after."),
	).toBe("Before :spoiler[**secret** :spoiler[inner]] after.");
	expect(
		normalizeMarkdown("::::spoiler{#id}\nOuter :spoiler[inline].\n\n:::spoiler\nInner.\n:::\n::::"),
	).toBe("::::spoiler\nOuter :spoiler[inline].\n\n:::spoiler\nInner.\n:::\n::::");
	expect(normalizeMarkdown(":unknown[visible]{secret=ignored}\n\n:::unknown\nBody.\n:::")).toBe(
		"visible\n\nBody.",
	);
	expect(normalizeMarkdown(":::spoiler[Label]\nBody.\n:::")).toBe(
		":::spoiler\nLabel\n\nBody.\n:::",
	);
	expect(normalizeMarkdown(":::unknown[Label]\nBody.\n:::")).toBe("Label\n\nBody.");
});

test("resolves relative links and keeps only HTTP and HTTPS destinations", () => {
	expect(
		normalizeMarkdown(
			"[relative](../item) [root](/cover) [web](https://example.org) [bad](javascript:alert) [mail](mailto:a@b.com)",
			{ baseUrl: "https://example.com/library/page" },
		),
	).toBe(
		"[relative](https://example.com/item) [root](https://example.com/cover) [web](https://example.org/) bad mail",
	);
	expect(normalizeMarkdown("[relative](/item) [broken](https://[invalid)")).toBe("relative broken");
	expect(
		normalizeMarkdown('<a href="//example.org/item">item</a><a href="data:text/html,bad">bad</a>', {
			baseUrl: "https://example.com/",
		}),
	).toBe("[item](https://example.org/item)bad");
	expect(normalizeMarkdown("[reference][id]\n\n[id]: https://example.com")).toBe(
		"[reference](https://example.com/)",
	);
});

test("flattens tables and code, keeps image alt text, and removes executable and fixture content", () => {
	expect(
		normalizeMarkdown(
			"<table><tr><th>Name</th><th>Value</th></tr><tr><td>A &amp; B</td><td><b>Two</b></td></tr></table>",
		),
	).toBe("Name | Value\n\nA & B | **Two**");
	expect(
		normalizeMarkdown(
			'<table><caption>Caption</caption><tr><td><img alt="Cover" src="x"></td><td><del>Deleted <b>bold</b></del></td></tr></table>',
		),
	).toBe("Caption\n\nCover | Deleted **bold**");
	expect(
		normalizeMarkdown(
			"<p><del>Deleted <strong>bold</strong></del> <s>strike</s> <u>underline</u></p>",
		),
	).toBe("Deleted **bold** strike underline");
	expect(
		normalizeMarkdown(
			"`*literal*`\n\n```ts\n[code]\nnext\n```\n\n![Cover](https://example.com/cover.png)",
		),
	).toBe("\\*literal\\*\n\n\\[code]\\\nnext\n\nCover");
	expect(
		normalizeMarkdown(
			'<p>Keep<script>bad()</script><style>bad</style> this.</p><form>hidden<input value="x"></form><iframe>hidden</iframe><video>hidden</video><audio>hidden</audio>',
		),
	).toBe("Keep this.");
	expect(normalizeMarkdown('<img src="x">')).toBe("");
});

test("keeps spoilers concealed in format wrappers and flattened table cells", () => {
	for (const input of [
		'<strong><div data-ryot-spoiler="block">secret</div></strong>',
		'<em><div data-ryot-spoiler="block">secret</div></em>',
		'<a href="https://example.com"><div data-ryot-spoiler="block">secret</div></a>',
		'<table><caption><em>Caption</em> <span data-ryot-spoiler="inline">secret caption</span></caption><tr><td><strong>Bold</strong></td><td><strong><div data-ryot-spoiler="block">secret <span data-ryot-spoiler="inline">secret nested</span></div></strong></td><td><a href="https://example.com">Link</a></td></tr></table>',
		"::::spoiler\n**:spoiler[secret :spoiler[secret nested]]**\n\n:::spoiler\nsecret block\n:::\n::::",
	]) {
		const canonical = normalizeMarkdown(input);
		const parsed = fromMarkdown(canonical, {
			extensions: [directive()],
			mdastExtensions: [directiveFromMarkdown()],
		});
		expect(canonical, input).toContain("secret");
		expect(visibleText(parsed), input).not.toContain("secret");
		expect(canonical, input).not.toContain("<");
		expect(normalizeMarkdown(canonical), input).toBe(canonical);
		if (input.startsWith("<table>")) {
			expect(canonical).toContain("*Caption*");
			expect(canonical).toContain("**Bold** | ");
			expect(canonical).toContain(" | [Link](https://example.com/)");
		}
	}
});

test("repairs malformed HTML and decodes entities exactly once", () => {
	expect(
		normalizeMarkdown("<p>One <b>bold</p><p>Two</b> &amp;amp; &#38; &lt;literal&gt;</p>"),
	).toBe("One **bold**\n\n**Two** \\&amp; & \\<literal>");
	expect(normalizeMarkdown("Literal \\&amp; and &amp;amp;")).toBe("Literal \\&amp; and \\&amp;");
});

test("literal text escapes punctuation and indentation without introducing Markdown structure", () => {
	const input = "    # title\n* bullet\n1. ordered\n\n:spoiler[secret] &amp; <b>literal</b>\\end";
	const escaped = escapeMarkdownText(input);
	expect(
		fromMarkdown(normalizeMarkdown(escaped), {
			extensions: [directive()],
			mdastExtensions: [directiveFromMarkdown()],
		}),
	).toMatchObject({
		type: "root",
		children: [
			{
				type: "paragraph",
				children: [
					{ type: "text", value: "# title" },
					{ type: "break" },
					{ type: "text", value: "* bullet" },
					{ type: "break" },
					{ type: "text", value: "1. ordered" },
				],
			},
			{
				type: "paragraph",
				children: [{ type: "text", value: ":spoiler[secret] &amp; <b>literal</b>\\end" }],
			},
		],
	});
});

test("canonical conversion is idempotent across supported and repaired input", () => {
	for (const input of [
		"# Heading\n\n**bold** *soft*\nnext\n\n> quote\n\n- a\n- b",
		":spoiler[outer :spoiler[inner]]{#drop}",
		"::::spoiler\n:::spoiler\nNested.\n:::\n::::",
		"<table><tr><td>A</td><td>B &amp;amp;</td></tr></table>",
		'<table><caption>Caption</caption><tr><td><img alt="Cover" src="x"></td><td><del>Text</del></td></tr></table>',
		":::spoiler[Label]\nBody\n:::",
		"<p><del>Deleted <strong>bold</strong></del> <u>underline</u></p>",
		"<p>One<b>two</p><p>three</b><br>four</p>",
		"[safe](/page) [unsafe](javascript:bad) ![alt](image.png)",
		"```\n*literal*\nnext\n```",
		"```\n    a    b\nnext\n```",
		"<pre>  a\n\n b\n</pre>",
		escapeMarkdownText("    # literal\n:spoiler[not a directive]\n\n&amp; <b>text</b>"),
	]) {
		const options = { baseUrl: "https://example.com/base/" };
		const canonical = normalizeMarkdown(input, options);
		expect(normalizeMarkdown(canonical, options), input).toBe(canonical);
		expect(canonical.endsWith("\n"), input).toBe(false);
	}
});
