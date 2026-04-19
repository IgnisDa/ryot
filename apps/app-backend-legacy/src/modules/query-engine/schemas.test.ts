import { describe, expect, it } from "bun:test";

import { queryEngineRequestSchema } from "./schemas";

const baseEntityRequest = {
	fields: [],
	filter: null,
	eventJoins: [],
	scope: ["books"],
	mode: "entities",
	computedFields: [],
	relationshipJoins: [],
	pagination: { page: 1, limit: 20 },
	sort: { expression: { type: "literal", value: null }, direction: "asc" },
} as const;

describe("queryEngineRequestSchema", () => {
	it("accepts typed date literals", () => {
		const result = queryEngineRequestSchema.safeParse({
			...baseEntityRequest,
			filter: {
				operator: "gte",
				type: "comparison",
				left: { type: "literal", literalType: "date", value: "2026-01-01T00:00:00.000Z" },
				right: { type: "literal", literalType: "date", value: "2026-01-02T00:00:00.000Z" },
			},
		});

		expect(result.success).toBe(true);
	});

	it("rejects invalid typed date literals", () => {
		const result = queryEngineRequestSchema.safeParse({
			...baseEntityRequest,
			filter: {
				operator: "gte",
				type: "comparison",
				right: { type: "literal", literalType: "date", value: "not-a-date" },
				left: { type: "literal", literalType: "date", value: "2026-01-01T00:00:00.000Z" },
			},
		});

		expect(result.success).toBe(false);
	});

	it("rejects duplicate scope slugs", () => {
		const result = queryEngineRequestSchema.safeParse({
			...baseEntityRequest,
			scope: ["books", "books"],
		});

		expect(result.success).toBe(false);
	});

	it("rejects duplicate event schema slugs", () => {
		const result = queryEngineRequestSchema.safeParse({
			filter: null,
			bucket: "day",
			scope: ["books"],
			computedFields: [],
			mode: "timeSeries",
			metric: { type: "count" },
			eventSchemas: ["review", "review"],
			dateRange: { endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
		});

		expect(result.success).toBe(false);
	});

	it("requires eventSchemas in events and timeSeries modes", () => {
		expect(
			queryEngineRequestSchema.safeParse({
				fields: [],
				filter: null,
				eventJoins: [],
				scope: ["books"],
				mode: "events",
				computedFields: [],
				pagination: { page: 1, limit: 20 },
				sort: { expression: { type: "literal", value: null }, direction: "asc" },
			}),
		).toMatchObject({ success: false });

		expect(
			queryEngineRequestSchema.safeParse({
				filter: null,
				bucket: "day",
				scope: ["books"],
				computedFields: [],
				mode: "timeSeries",
				metric: { type: "count" },
				dateRange: { endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
			}),
		).toMatchObject({ success: false });
	});

	it("rejects time-series dateRange datetimes beyond millisecond precision", () => {
		const result = queryEngineRequestSchema.safeParse({
			filter: null,
			bucket: "day",
			scope: ["books"],
			computedFields: [],
			mode: "timeSeries",
			eventSchemas: ["review"],
			metric: { type: "count" },
			dateRange: { startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-01-02T00:00:00.000001Z" },
		});

		expect(result.success).toBe(false);
	});

	it("rejects pagination limits above 1000", () => {
		const result = queryEngineRequestSchema.safeParse({
			...baseEntityRequest,
			pagination: { page: 1, limit: 1001 },
		});

		expect(result.success).toBe(false);
	});
});
