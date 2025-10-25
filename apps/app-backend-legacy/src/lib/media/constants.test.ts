import { describe, expect, it } from "bun:test";

import { builtinMediaEntitySchemaSlugs } from "./constants";

describe("builtinMediaEntitySchemaSlugs", () => {
	it("includes group entity slugs", () => {
		for (const slug of [
			"book-group",
			"movie-group",
			"music-group",
			"audiobook-group",
			"comic-book-group",
			"video-game-group",
		] as const) {
			expect(builtinMediaEntitySchemaSlugs).toContain(slug);
		}
	});
});
