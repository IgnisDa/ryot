import { describe, expect, it } from "bun:test";
import { normalizeRequestPerMode } from "./preparer";

describe("normalizeRequestPerMode", () => {
	it("preserves eventJoins and relationships for entities mode", () => {
		const result = normalizeRequestPerMode({
			fields: [],
			filter: null,
			mode: "entities",
			scope: ["books"],
			computedFields: [],
			pagination: { page: 1, limit: 20 },
			relationships: [{ relationshipSchemaSlug: "owner" }],
			sort: { expression: { type: "literal", value: null }, direction: "asc" },
			eventJoins: [
				{ key: "review", eventSchemaSlug: "review", kind: "latestEvent" },
			],
		});
		expect(result.mode).toBe("entities");
		expect(result.eventJoins).toHaveLength(1);
		expect(result.relationships).toHaveLength(1);
		expect(result.eventSchemas).toEqual([]);
	});

	it("preserves eventJoins and relationships for aggregate mode", () => {
		const result = normalizeRequestPerMode({
			filter: null,
			scope: ["books"],
			aggregations: [],
			mode: "aggregate",
			computedFields: [],
			relationships: [{ relationshipSchemaSlug: "owner" }],
			eventJoins: [
				{ key: "review", eventSchemaSlug: "review", kind: "latestEvent" },
			],
		});
		expect(result.mode).toBe("aggregate");
		expect(result.eventJoins).toHaveLength(1);
		expect(result.relationships).toHaveLength(1);
		expect(result.eventSchemas).toEqual([]);
	});

	it("preserves eventJoins and eventSchemas for events mode, clears relationships", () => {
		const result = normalizeRequestPerMode({
			fields: [],
			filter: null,
			mode: "events",
			scope: ["books"],
			computedFields: [],
			pagination: { page: 1, limit: 20 },
			eventSchemas: ["review", "complete"],
			sort: { expression: { type: "literal", value: null }, direction: "asc" },
			eventJoins: [
				{ key: "review", eventSchemaSlug: "review", kind: "latestEvent" },
			],
		});
		expect(result.mode).toBe("events");
		expect(result.eventJoins).toHaveLength(1);
		expect(result.eventSchemas).toEqual(["review", "complete"]);
		expect(result.relationships).toEqual([]);
	});

	it("clears eventJoins and relationships for timeSeries mode, preserves eventSchemas", () => {
		const result = normalizeRequestPerMode({
			filter: null,
			bucket: "day",
			scope: ["books"],
			mode: "timeSeries",
			computedFields: [],
			eventSchemas: ["review"],
			metric: { type: "count" },
			dateRange: {
				endAt: "2026-01-08T00:00:00.000Z",
				startAt: "2026-01-01T00:00:00.000Z",
			},
		});
		expect(result.mode).toBe("timeSeries");
		expect(result.eventJoins).toEqual([]);
		expect(result.relationships).toEqual([]);
		expect(result.eventSchemas).toEqual(["review"]);
	});
});
