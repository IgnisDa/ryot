import { describe, expect, it } from "bun:test";

import { Result } from "@ryot-app/plugin-kit/effect";
import { bindRecipe } from "@ryot-app/ryotql-recipes/test-utils";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "@ryot-app/ryotql/validator";

import { mediaActivityRecipe } from "./activity-recipes";

describe("media activity recipe", () => {
	it("validates the document", () => {
		expect(
			validateRyotQLDocument(
				bindRecipe(mediaActivityRecipe({ kind: "self" }), {}).document,
				savedViewDataSourceAccess,
			).error,
		).toBeNull();
	});

	it("bounds every aggregate by the window and counts timed and date-only days together", () => {
		const { queries } = bindRecipe(mediaActivityRecipe({ kind: "self" }), {}).document;
		for (const name of ["days", "figures", "mediaTypes"]) {
			expect(JSON.stringify(queries[name]?.where)).toContain("calendarDate");
		}
		expect(JSON.stringify(queries["days"]?.where)).toContain("activeObservation");
		expect(JSON.stringify(queries["reviews"]?.where)).toContain("2026-01-01T00:00:00.000Z");
		expect(JSON.stringify(queries)).not.toContain("projectionStatus");
	});

	it("reads the empty sums of a quiet year as zero", () => {
		const decoded = bindRecipe(mediaActivityRecipe({ kind: "self" }), {}).decode({
			data: {
				reviews: { type: "aggregate", items: [{ reviews: 0 }] },
				figures: {
					type: "aggregate",
					items: [{ minutes: null, finished: null, minutesMissing: null }],
				},
				days: {
					items: [],
					type: "aggregate",
					pageInfo: { limit: 100, hasMore: false, nextCursor: null },
				},
				mediaTypes: {
					items: [],
					type: "aggregate",
					pageInfo: { limit: 100, hasMore: false, nextCursor: null },
				},
			},
		});
		expect(Result.getOrThrow(decoded).figures).toEqual({
			minutes: 0,
			reviews: 0,
			finished: 0,
			minutesMissing: 0,
		});
	});
});
