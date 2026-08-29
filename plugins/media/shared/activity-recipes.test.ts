import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { describe, expect, it } from "vitest";

import { mediaActivityRecipe } from "./activity-recipes";

const INPUT = {
	timeZone: "Asia/Kolkata",
	from: "2025-09-28T18:30:00.000Z",
	until: "2026-09-25T18:30:00.000Z",
};

describe("media activity recipe", () => {
	it("validates the document", () => {
		expect(
			validateRyotQLDocument(mediaActivityRecipe(INPUT).document, savedViewDataSourceAccess),
		).toBeNull();
	});

	it("reads the empty sums of a quiet year as zero", () => {
		const decoded = mediaActivityRecipe(INPUT).decode({
			data: {
				days: { items: [], type: "aggregate" },
				mediaTypes: { items: [], type: "aggregate" },
				figures: { type: "aggregate", items: [{ minutes: null, reviews: null, finished: null }] },
			},
		});
		expect(Result.getOrThrow(decoded).figures).toEqual({ minutes: 0, reviews: 0, finished: 0 });
	});
});
