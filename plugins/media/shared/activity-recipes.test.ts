import {
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/kernel-backend/modules/ryotql/validator";
import { Result } from "@ryot-app/plugin-kit/effect";
import { TimeZone } from "@ryot-app/plugin-kit/schema";
import { describe, expect, it } from "vitest";

import { mediaActivityRecipe } from "./activity-recipes";

const INPUT = {
	from: "2025-09-28T18:30:00.000Z",
	until: "2026-09-25T18:30:00.000Z",
	timeZone: TimeZone.make("Asia/Kolkata"),
};

describe("media activity recipe", () => {
	it("validates the document", () => {
		expect(
			validateRyotQLDocument(
				mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).document,
				savedViewDataSourceAccess,
			).error,
		).toBeNull();
	});

	it("bounds every aggregate by the window and counts timed and date-only days together", () => {
		const { queries } = mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).document;
		for (const name of ["days", "figures", "mediaTypes"]) {
			expect(JSON.stringify(queries[name]?.where)).toContain("calendarDate");
		}
		expect(JSON.stringify(queries["days"]?.where)).toContain("activeObservation");
		expect(JSON.stringify(queries["reviews"]?.where)).toContain(INPUT.from);
		expect(JSON.stringify(queries)).not.toContain("projectionStatus");
	});

	it("reads the empty sums of a quiet year as zero", () => {
		const decoded = mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).decode({
			data: {
				days: { items: [], type: "aggregate", pageInfo: { limit: 100, hasMore: false, nextCursor: null } },
				mediaTypes: { items: [], type: "aggregate", pageInfo: { limit: 100, hasMore: false, nextCursor: null } },
				reviews: { type: "aggregate", items: [{ reviews: 0 }] },
				figures: {
					type: "aggregate",
					items: [{ minutes: null, finished: null, minutesMissing: null }],
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
