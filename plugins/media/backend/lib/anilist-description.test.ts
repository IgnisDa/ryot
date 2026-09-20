import { MarkdownContent, markdownPlainText } from "@ryot-app/client-ui-sdk/markdown";
import { load } from "@ryot-app/sandbox-sdk/cheerio";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assert, describe, expect, it } from "vitest";

import { normalizeAnilistDescription } from "./anilist-description";
import { normalizeRichDescription } from "./rich-description";

describe("AniList descriptions", () => {
	it.each([
		{
			visible: "",
			paragraphs: 2,
			controls: ["block"],
			concealed: ["secret heading", "secret tail"],
			input: '<span class="markdown_spoiler"><h2>secret heading</h2>secret tail</span>',
		},
		{
			visible: "",
			paragraphs: 2,
			controls: ["block"],
			concealed: ["secret code", "secret tail"],
			input: '<span class="markdown_spoiler"><pre>secret code</pre>secret tail</span>',
		},
		{
			visible: "",
			paragraphs: 2,
			controls: ["block"],
			concealed: ["secret cell", "secret tail"],
			input:
				'<span class="markdown_spoiler"><table><tr><td>secret cell</td></tr></table>secret tail</span>',
		},
		{
			visible: "",
			paragraphs: 2,
			controls: ["block"],
			concealed: ["first", "secret second"],
			input: '<span class="markdown_spoiler">first\n\nsecret second</span>',
		},
		{
			paragraphs: 4,
			controls: ["block", "block"],
			visible: "Public before public after",
			concealed: ["secret first", "secret inner one", "secret inner two", "secret trailing"],
			input:
				'Public before <span class="markdown_spoiler">secret first ~!secret inner one\n\n**secret inner two**!~ secret trailing</span> public after',
		},
		{
			paragraphs: 0,
			visible: "public",
			controls: ["inline", "inline"],
			concealed: ["secret outer", "secret inner", "secret tail"],
			input:
				'<span class="markdown_spoiler">secret outer <span class="markdown_spoiler"><em>secret inner</em></span> secret tail</span> public',
		},
		{
			paragraphs: 4,
			visible: "public",
			controls: ["block", "block"],
			concealed: ["secret outer", "secret inner one", "secret inner two", "secret tail"],
			input:
				'<span class="markdown_spoiler">secret outer <span class="markdown_spoiler">secret inner one\n\n*secret inner two*</span> secret tail</span> public',
		},
		{
			paragraphs: 3,
			visible: "Public",
			controls: ["block"],
			concealed: ["secret first", "secret second", "secret tail"],
			input:
				'Public\n\n<span class="markdown_spoiler">secret first\n\n**secret second**\n\nsecret tail',
		},
		{
			paragraphs: 2,
			visible: "Public",
			controls: ["block"],
			concealed: ["secret first", "secret second"],
			input: '<p>Public <span class="markdown_spoiler">secret first</p>\n\nsecret second',
		},
		{
			paragraphs: 2,
			controls: ["block"],
			visible: "Public before public after",
			concealed: ["secret first", "secret second"],
			input:
				'<strong>Public before <span class="markdown_spoiler"><p>secret first</p><p><em>secret second</em></p></span> public after</strong>',
		},
		{
			paragraphs: 2,
			controls: ["block"],
			visible: "Public before Public after",
			concealed: ["secret first", "secret second"],
			input:
				'*Public* [before](/before)\n\n<span class="markdown_spoiler">secret first\n\n[secret second](/secret)</span>\n\n**Public** [after](/after)',
		},
	])(
		"conceals complete native source wrappers: $input",
		({ input, visible, controls, concealed, paragraphs }) => {
			const canonical = Effect.runSync(normalizeAnilistDescription(input, "https://anilist.co"));
			assert(canonical !== null);
			expect(markdownPlainText(canonical)).toBe(visible);
			const rendered = load(
				renderToStaticMarkup(
					createElement(MarkdownContent, { text: canonical, onOpenLink: () => undefined }),
				),
				undefined,
				false,
			);
			const spoilerControls = rendered("details, span:has(> button)");
			expect(
				spoilerControls
					.toArray()
					.map((element) => (element.name === "details" ? "block" : "inline")),
			).toEqual(controls);
			expect(rendered("details p").length).toBe(paragraphs);
			const prose = spoilerControls.clone();
			prose.find("summary, button").remove();
			const concealedText = prose.first().text().replace(/\s+/g, " ").trim();
			if (paragraphs > 0) {
				expect(
					prose
						.first()
						.find("p")
						.toArray()
						.map((element) => rendered(element).text().trim()),
				).toEqual(concealed);
			} else {
				expect(concealedText).toBe(concealed.join(" "));
			}
			expect(Effect.runSync(normalizeRichDescription(canonical, "https://anilist.co"))).toBe(
				canonical,
			);
		},
	);

	it.each([
		[
			'Before <span class="markdown_spoiler"><strong>secret</strong> <span class="markdown_spoiler"><em>nested</em></span></span> after',
			"Before :spoiler[**secret** :spoiler[*nested*]] after",
		],
		[
			"Before ~!**secret** ~!*nested*!~!~ after",
			"Before :spoiler[**secret** :spoiler[*nested*]] after",
		],
		["Before ~!secret ~!**nested**", "Before :spoiler[secret :spoiler[**nested**]]"],
		[
			"Before\n\n~!first\n\n*second*!~\n\nAfter",
			"Before\n\n:::spoiler\nfirst\n\n*second*\n:::\n\nAfter",
		],
		[
			"~!<p>first <strong>secret</strong></p><p>second</p>!~",
			":::spoiler\nfirst **secret**\n\nsecond\n:::",
		],
		[
			"~!outer\n\n~!inner\n\n**secret**!~\n\ntail!~",
			"::::spoiler\nouter\n\n:::spoiler\ninner\n\n**secret**\n:::\n\ntail\n::::",
		],
		[
			"**before ~!first\n\nsecond!~ after**",
			"\\*\\*before\n\n:::spoiler\nfirst\n\nsecond\n:::\n\nafter\\*\\*",
		],
		["Before ~!**secret**\n\n*tail*", "Before\n\n:::spoiler\n**secret**\n\n*tail*\n:::"],
		[
			'<p><strong>Before <span class="markdown_spoiler">secret <em>tail</em></span> after</strong></p>',
			"**Before :spoiler[secret *tail*] after**",
		],
		[
			"<strong>Before ~!<p>secret</p><p><em>tail</em></p>!~ after</strong>",
			"**Before**\n\n:::spoiler\nsecret\n\n*tail*\n:::\n\n**after**",
		],
	])("keeps all spoiler text inside directives: %s", (input, expected) => {
		const canonical = Effect.runSync(normalizeAnilistDescription(input));
		expect(canonical).toBe(expected);
		expect(Effect.runSync(normalizeRichDescription(canonical))).toBe(expected);
	});

	it("preserves Markdown outside HTML fragments and resolves links", () => {
		expect(
			Effect.runSync(
				normalizeAnilistDescription(
					'First *paragraph*.\n\n<span class="other markdown_spoiler">secret <a href="/anime/1">link</a></span>\n\nLast **paragraph**.',
					"https://anilist.co",
				),
			),
		).toBe(
			"First *paragraph*.\n\n:spoiler[secret [link](https://anilist.co/anime/1)]\n\nLast **paragraph**.",
		);
		expect(
			Effect.runSync(normalizeAnilistDescription("First *paragraph*.\n\nLast **paragraph**.")),
		).toBe("First *paragraph*.\n\nLast **paragraph**.");
		expect(
			Effect.runSync(
				normalizeAnilistDescription(
					'*Public* [before](/before)\n\n<span class="markdown_spoiler">secret first\n\n[secret second](/secret)</span>\n\n**Public** [after](/after)',
					"https://anilist.co",
				),
			),
		).toBe(
			"*Public* [before](https://anilist.co/before)\n\n:::spoiler\nsecret first\n\n[secret second](https://anilist.co/secret)\n:::\n\n**Public** [after](https://anilist.co/after)",
		);
	});

	it("does not treat unrelated classes as provider spoilers", () => {
		expect(
			Effect.runSync(normalizeAnilistDescription('<span class="spoiler">visible</span>')),
		).toBe("visible");
	});

	it.each([undefined, null, 42, {}, "", " \n\t ", "<p></p>"])(
		"returns null for absent or empty prose: %j",
		(input) => {
			expect(Effect.runSync(normalizeAnilistDescription(input))).toBeNull();
		},
	);
});
