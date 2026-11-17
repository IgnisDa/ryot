import { describe, expect, it } from "bun:test";

import { testMediaText } from "../../tests/client/test-text";
import { mediaCursorPageError } from "./cursor-page-state";

describe("media cursor page state", () => {
	it("keeps error copy free of decoder and transport internals", () => {
		expect(
			mediaCursorPageError(testMediaText, { kind: "episodes", state: { status: "malformed" } })
				.detail,
		).not.toContain("RyotQL");
		const failure = mediaCursorPageError(testMediaText, {
			kind: "episodes",
			state: { status: "transport-error" },
		});
		expect<string>(failure.title).toBe("Unable to load these episodes");
		expect<string>(failure.detail).toBe(
			"These episodes could not be loaded. Check your connection and try again.",
		);
	});
});
