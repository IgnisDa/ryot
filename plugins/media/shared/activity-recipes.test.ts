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
			validateRyotQLDocument(
				mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).document,
				savedViewDataSourceAccess,
			).error,
		).toBeNull();
	});

	it("filters repaired attribution and active evidence for daily counts and shares", () => {
		const { queries } = mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).document;
		const where = (name: string) => JSON.stringify(queries[name]?.where);

		expect(where("days")).toContain("activeObservation");
		expect(where("dates")).toContain("attribution");
		expect(where("mediaTypes")).toContain("projectionStatus");
	});

	it("reads the empty sums of a quiet year as zero", () => {
		const decoded = mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).decode({
			data: {
				days: { items: [], type: "aggregate" },
				dates: { items: [], type: "aggregate" },
				mediaTypes: { items: [], type: "aggregate" },
				figures: {
					type: "aggregate",
					items: [
						{
							failed: 0,
							pending: 0,
							minutes: null,
							reviews: null,
							finished: null,
							minutesMissing: 0,
						},
					],
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
	it("combines date-only and timed activity on the same local day and exposes incomplete repairs", () => {
		const result = Result.getOrThrow(
			mediaActivityRecipe({ ...INPUT, reference: { kind: "self" } }).decode({
				data: {
					mediaTypes: { items: [], type: "aggregate" },
					dates: { type: "aggregate", items: [{ events: 3, day: "2026-09-25" }] },
					days: { type: "aggregate", items: [{ events: 2, day: "2026-09-24T18:30:00.000Z" }] },
					figures: {
						type: "aggregate",
						items: [
							{ failed: 0, minutes: 0, reviews: 0, pending: 1, finished: 0, minutesMissing: 0 },
						],
					},
				},
			}),
		);
		expect(result.days).toEqual([{ events: 5, day: "2026-09-25" }]);
		expect(result.processing).toBe("pending");
	});
});
