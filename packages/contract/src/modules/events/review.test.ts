import { expect, it } from "bun:test";

import { reviewPropertiesPatch } from "./review";

it("sets present review properties and removes the rest", () => {
	expect(reviewPropertiesPatch({ rating: 0, text: "Great", isSpoiler: true })).toEqual({
		remove: [],
		set: { rating: 0, text: "Great", isSpoiler: true },
	});
	expect(reviewPropertiesPatch({ rating: 40, text: null, isSpoiler: true })).toEqual({
		set: { rating: 40 },
		remove: ["text", "isSpoiler"],
	});
	expect(reviewPropertiesPatch({ text: "Note", rating: null })).toEqual({
		set: { text: "Note" },
		remove: ["isSpoiler", "rating"],
	});
});
