import { describe, expect, it } from "vitest";

import type { QueryDocumentV2 } from "./language";
import { validateQueryDocumentV2 } from "./validator";
import { createdAtRef, propertyRef } from "./validator.test-support";

const makeTimeSeriesDoc = (overrides: Partial<QueryDocumentV2> = {}): QueryDocumentV2 => ({
	version: 2,
	source: { alias: "e", where: null, type: "entities", schemas: ["books"] },
	output: {
		type: "timeSeries",
		measure: { aggregation: { function: "count" } },
		time: {
			bucket: "day",
			expr: createdAtRef("e"),
			range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
		},
	},
	...overrides,
});

describe("time-series validation", () => {
	it("accepts a count time series over an entity date expression", () => {
		expect(validateQueryDocumentV2(makeTimeSeriesDoc())).toBeNull();
	});

	it("accepts shared aggregation specs for the measure", () => {
		const doc = makeTimeSeriesDoc({
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "sum", expr: propertyRef("e", "books", ["pages"]) } },
				time: {
					bucket: "day",
					expr: createdAtRef("e"),
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toBeNull();
	});

	it("rejects invalid date ranges", () => {
		const doc = makeTimeSeriesDoc({
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					expr: createdAtRef("e"),
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-03T00:00:00.000Z" },
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toMatch(/startAt must be before endAt/);
	});

	it("rejects more than 1000 aligned buckets", () => {
		const doc = makeTimeSeriesDoc({
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					expr: createdAtRef("e"),
					range: { endAt: "2028-10-01T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toMatch(/bucket count .* exceeds maximum of 1000/);
	});

	it("rejects unknown aliases in the time expression", () => {
		const doc = makeTimeSeriesDoc({
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					expr: createdAtRef("missing"),
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
		});

		expect(validateQueryDocumentV2(doc)).toMatch(/Unknown source alias 'missing'/);
	});
});
