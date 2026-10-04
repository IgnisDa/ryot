import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthoredFilterField, Filter, FilterField } from "./filters";
import { EntityBrowserSavedViewSettings, ResultsTableSavedViewSettings } from "./schemas";

const decodes = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
	Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

describe("filter schemas", () => {
	it("decodes nested and, or and not trees", () => {
		const filter = {
			type: "and",
			filters: [
				{ field: "level", operator: "anyOf", values: ["beginner"] },
				{
					type: "or",
					filters: [
						{ type: "not", filter: { field: "name", value: "squat", operator: "contains" } },
						{ days: 7, field: "added", operator: "withinLastDays" },
					],
				},
			],
		};
		expect(Schema.decodeSync(Filter)(filter)).toEqual(filter);
	});

	it("rejects operators paired with the wrong value shape", () => {
		for (const rule of [
			{ values: [], field: "level", operator: "anyOf" },
			{ field: "level", operator: "anyOf", value: "beginner" },
			{ value: "3", field: "reps", operator: "gte" },
			{ min: 1, field: "reps", operator: "between" },
			{ field: "added", operator: "before", value: "not-a-date" },
			{ days: 0, field: "added", operator: "withinLastDays" },
			{ value: "x", field: "name", operator: "unknown" },
			{ type: "and", filters: [{ values: ["x"], field: "level", operator: "isTrue" }] },
		]) {
			expect(decodes(Filter, rule)).toBe(false);
		}
	});

	it("requires choices for enum value fields and forbids them otherwise", () => {
		const base = { key: "level", kind: "value", label: "Level", field: "level" };
		const choices = [{ value: "beginner", label: "Beginner" }];
		expect(decodes(FilterField, { ...base, choices, type: "enum" })).toBe(true);
		expect(decodes(FilterField, { ...base, type: "enum" })).toBe(false);
		expect(decodes(FilterField, { ...base, choices: [], type: "enum-list" })).toBe(false);
		expect(decodes(FilterField, { ...base, type: "text" })).toBe(true);
		expect(decodes(FilterField, { ...base, choices, type: "text" })).toBe(false);
	});

	it("decodes relationship fields with plugin and authored owners", () => {
		const base = { key: "tags", label: "Tags", kind: "relationship", direction: "outgoing" };
		expect(
			decodes(FilterField, {
				...base,
				relationship: { slug: "tagged", owner: { kind: "plugin", pluginId: "plugin-1" } },
			}),
		).toBe(true);
		expect(
			decodes(AuthoredFilterField, {
				...base,
				relationship: { slug: "tagged", owner: { kind: "self" } },
			}),
		).toBe(true);
		expect(
			decodes(FilterField, { ...base, relationship: { slug: "tagged", owner: { kind: "self" } } }),
		).toBe(false);
	});

	it("keeps filterFields optional on entity-browser and results-table settings", () => {
		const table = {
			pageSize: 10,
			entityLink: null,
			sourceName: "rows",
			rowKeyFields: ["id"],
			columns: [{ label: "Id", field: "id", displayKind: "text" }],
		};
		const field = { key: "id", label: "Id", field: "id", type: "text", kind: "value" };
		expect(decodes(ResultsTableSavedViewSettings, table)).toBe(true);
		expect(decodes(ResultsTableSavedViewSettings, { ...table, filterFields: [field] })).toBe(true);
		const browser = {
			pageSize: 10,
			sortChoices: [],
			addAction: null,
			searchFields: [],
			layouts: ["grid"],
			tableColumns: null,
			sourceName: "rows",
			defaultLayout: "grid",
			subject: { entityAlias: "entity", schemas: [{ slug: "book", owner: { kind: "kernel" } }] },
		};
		expect(decodes(EntityBrowserSavedViewSettings, browser)).toBe(true);
		expect(decodes(EntityBrowserSavedViewSettings, { ...browser, filterFields: [field] })).toBe(
			true,
		);
		expect(
			decodes(EntityBrowserSavedViewSettings, { ...browser, filterFields: [{ key: "x" }] }),
		).toBe(false);
	});
});
