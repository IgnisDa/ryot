import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { combineDescription } from "./giant-bomb";

describe("GiantBomb descriptions", () => {
	it("combines a literal deck with formatted prose and source-relative links", () => {
		expect(
			Effect.runSync(
				combineDescription(
					"A *literal* deck.",
					'<p>A <strong>story</strong> with <a href="/games/">details</a>.</p>',
				),
			),
		).toBe(
			"A \\*literal\\* deck\\.\n\nA **story** with [details](https://www.giantbomb.com/games/).",
		);
	});

	it.each([
		["", "<p>Body</p>", "Body"],
		[" Deck ", "<script>hidden</script>", "Deck"],
		[" ", "<p></p>", null],
		[null, undefined, null],
	])("includes only present prose: %j, %j", (deck, description, expected) => {
		expect(Effect.runSync(combineDescription(deck, description))).toBe(expected);
	});
});
