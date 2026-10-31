import { describe, expect, it } from "vitest";

import { mediaCursorPageError } from "./cursor-page-state";

describe("media cursor page state", () => {
	it("keeps error copy free of decoder and transport internals", () => {
		expect(
			mediaCursorPageError({ noun: "episodes", state: { status: "malformed" } }).detail,
		).not.toContain("RyotQL");
		expect(
			mediaCursorPageError({ noun: "episodes", state: { status: "transport-error" } }),
		).toEqual({
			title: "Unable to load these episodes",
			detail: "These episodes could not be loaded. Check your connection and try again.",
		});
	});
});
