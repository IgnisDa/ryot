import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { describe, expect, it } from "vitest";

import { normalizeVndbDescription } from "./vndb-description";

describe("VNDB descriptions", () => {
	it("keeps raw syntax, URLs, IDs, and HTML literal", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription("[raw][b]literal[/b] v4 https://example.org <script>[/raw]"),
			),
		).toBe("\\[b]literal\\[/b] v4 https://example.org \\<script>");
	});

	it("normalizes nested emphasis and retains underline and strike text", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription("[b]Bold [i]inner[/i][/b] [u]under[/u] [s]strike[/s]"),
			),
		).toBe("**Bold *inner*** under strike");
	});

	it("keeps nested spoilers concealed and formatting inside them", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription("[spoiler]hidden [spoiler][b]nested[/b][/spoiler][/spoiler]"),
			),
		).toBe(":spoiler[hidden :spoiler[**nested**]]");
	});

	it("retains quotes and paragraph breaks within block spoilers", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription("[spoiler][quote]one\n\ntwo [i]three[/i][/quote][/spoiler]"),
			),
		).toBe(":::spoiler\n> one\\\n> \\\n> two *three*\n:::");
	});

	it("keeps block spoilers concealed inside formatting and links", () => {
		expect(
			Effect.runSync(normalizeVndbDescription("[b]before [spoiler]one\n\ntwo[/spoiler] after[/b]")),
		).toBe("**before**\n\n:::spoiler\n**one\\\n\\\ntwo**\n:::\n\n**after**");
		expect(
			Effect.runSync(
				normalizeVndbDescription("[url=https://example.org][spoiler]one\n\ntwo[/spoiler][/url]"),
			),
		).toBe(":::spoiler\n[one\\\n\\\ntwo](https://example.org/)\n:::");
	});

	it("resolves explicit relative links and documented automatic links", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription(
					"[url=/v4]v4[/url] v4.4 https://example.org/a.",
					"https://vndb.org",
				),
			),
		).toBe("[v4](https://vndb.org/v4) [v4.4](https://vndb.org/v4.4) <https://example.org/a>.");
	});

	it("preserves unsafe link labels without accepting attribute injection", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription('[url=javascript:alert(1)]keep <label> & "text"[/url]'),
			),
		).toBe('keep \\<label> & "text"');
		expect(
			Effect.runSync(
				normalizeVndbDescription('[url=/v4" onclick="alert(1)]label[/url]', "https://vndb.org"),
			),
		).toBe("[label](https://vndb.org/v4%22%20onclick=%22alert\\(1\\))");
	});

	it("does not auto-link labels inside explicit links", () => {
		expect(
			Effect.runSync(
				normalizeVndbDescription("[url=https://example.org][b]v4[/b] https://vndb.org[/url]"),
			),
		).toBe("[**v4** https://vndb.org](https://example.org/)");
	});

	it("preserves unknown, mismatched, and unclosed formatting tags literally", () => {
		expect(Effect.runSync(normalizeVndbDescription("[other]text[/other]"))).toBe(
			"\\[other]text\\[/other]",
		);
		expect(Effect.runSync(normalizeVndbDescription("[b]open[/i] tail"))).toBe(
			"\\[b]open\\[/i] tail",
		);
		expect(Effect.runSync(normalizeVndbDescription("[raw][b]open"))).toBe("\\[raw]\\[b]open");
	});

	it.each([
		["[spoiler]secret", ":spoiler[secret]"],
		[
			"[spoiler]secret [b]nested[/spoiler] tail",
			":spoiler[secret \\[b\\]nested\\[/spoiler\\] tail]",
		],
		["[b][spoiler]secret", "\\[b]:spoiler[secret]"],
	])("conceals the remainder of malformed spoilers: %s", (input, expected) => {
		expect(Effect.runSync(normalizeVndbDescription(input))).toBe(expected);
	});

	it("keeps original Markdown punctuation literal and preserves paragraph breaks", () => {
		expect(Effect.runSync(normalizeVndbDescription("# Title *stars*\n\nnext"))).toBe(
			"\\# Title \\*stars\\*\\\n\\\nnext",
		);
	});

	it.each([undefined, null, 42, {}, "", " \n\t ", "[b][/b]"])(
		"returns null for absent or empty prose: %j",
		(input) => {
			expect(Effect.runSync(normalizeVndbDescription(input))).toBeNull();
		},
	);
});
