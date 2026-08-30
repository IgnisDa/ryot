import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { OutputFieldKey, Pagination, RyotQLDocument, RyotQLResponse } from "./language";

const document = {
	queries: {
		collections: {
			from: { table: "entity", alias: "collection" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { limit: 20 },
				fields: [{ key: "id", expr: { field: "id", type: "column", tableAlias: "collection" } }],
			},
		},
	},
} as const;

const makeDocument = (expr: unknown) => ({
	queries: {
		entities: {
			from: { table: "entity", alias: "entity" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { limit: 20 },
				fields: [{ expr, key: "value" }],
			},
		},
	},
});

describe("RyotQLDocument", () => {
	it("decodes a named rows document", () => {
		expect(Schema.decodeUnknownSync(RyotQLDocument)(document)).toEqual(document);
	});

	it("decodes wildcard row selections", () => {
		const wildcard = {
			...document,
			queries: {
				collections: {
					...document.queries.collections,
					output: {
						...document.queries.collections.output,
						fields: [{ type: "wildcard", tableAlias: "collection" }],
					},
				},
			},
		} as const;
		expect(Schema.decodeUnknownSync(RyotQLDocument)(wildcard)).toEqual(wildcard);
	});

	it("rejects unknown keys throughout the document", () => {
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)({
				...document,
				queries: { collections: { ...document.queries.collections, authority: "admin" } },
			}),
		).toThrow();
	});

	it("rejects invalid pagination", () => {
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)({
				queries: {
					collections: {
						...document.queries.collections,
						output: {
							...document.queries.collections.output,
							pagination: { after: "", limit: 20 },
						},
					},
				},
			}),
		).toThrow();
	});

	it("decodes recursive JSON and predicate expressions", () => {
		const properties = { type: "column", field: "properties", tableAlias: "entity" } as const;
		const score = {
			type: "cast",
			target: "number",
			expr: { type: "jsonPath", expr: properties, path: ["details", 0, "score"] },
		} as const;
		const complex = {
			queries: {
				entities: {
					from: { table: "entity", alias: "entity" },
					where: {
						type: "and",
						predicates: [
							{
								left: score,
								operator: "gte",
								type: "comparison",
								right: { value: 4, type: "literal" },
							},
							{ expr: score, type: "isNotNull" },
						],
					},
					output: {
						type: "rows",
						pagination: { limit: 20 },
						orderBy: [{ expr: score, direction: "desc" }],
						fields: [
							{
								key: "score",
								expr: { type: "coalesce", values: [score, { value: 0, type: "literal" }] },
							},
						],
					},
				},
			},
		} as const;

		expect(Schema.decodeUnknownSync(RyotQLDocument)(complex)).toEqual(complex);
	});

	it("decodes correlated query and arithmetic expressions", () => {
		const eventQuery = {
			from: { table: "event", alias: "event" },
			where: {
				operator: "eq",
				type: "comparison",
				right: { field: "id", type: "column", tableAlias: "entity" },
				left: { type: "column", field: "entityId", tableAlias: "event" },
			},
		} as const;
		const correlated = {
			queries: {
				entities: {
					from: { table: "entity", alias: "entity" },
					where: { type: "exists", query: eventQuery },
					output: {
						orderBy: [],
						type: "rows",
						pagination: { limit: 20 },
						fields: [
							{
								key: "latestEvent",
								expr: {
									type: "first",
									query: eventQuery,
									select: { type: "column", tableAlias: "event", field: "occurredAt" },
									orderBy: [
										{
											direction: "desc",
											expr: { type: "column", tableAlias: "event", field: "occurredAt" },
										},
									],
								},
							},
							{
								key: "ratio",
								expr: {
									type: "arithmetic",
									operator: "divide",
									right: { value: 2, type: "literal" },
									left: {
										type: "aggregate",
										query: eventQuery,
										aggregation: { function: "count" },
									},
								},
							},
						],
					},
				},
			},
		} as const;

		expect(Schema.decodeUnknownSync(RyotQLDocument)(correlated)).toEqual(correlated);
	});

	it("decodes scalar operations with recursive expressions and predicates", () => {
		const value = { field: "name", type: "column", tableAlias: "entity" } as const;
		const createdAt = { type: "column", field: "createdAt", tableAlias: "entity" } as const;
		const expressions = [
			{ type: "concat", values: [value, { type: "literal", value: " suffix" }] },
			{
				type: "conditional",
				whenFalse: { value: null, type: "literal" },
				condition: { expr: value, type: "isNotNull" },
				whenTrue: { expr: value, type: "transform", name: "titleCase" },
			},
			{ expr: value, type: "transform", name: "kebabCase" },
			{ expr: value, type: "round" },
			{ expr: value, type: "floor" },
			{ expr: value, type: "integer" },
			{ expr: value, type: "isNotNull" },
			{ bucket: "day", expr: createdAt, type: "dateBucket", timeZone: "America/New_York" },
		] as const;

		for (const expr of expressions) {
			expect(Schema.decodeUnknownSync(RyotQLDocument)(makeDocument(expr))).toEqual(
				makeDocument(expr),
			);
		}
	});

	it("exports positive cursor pagination and non-empty output field-key schemas", () => {
		expect(Schema.decodeUnknownSync(Pagination)({ limit: 20, after: "cursor" })).toEqual({
			limit: 20,
			after: "cursor",
		});
		expect(Schema.decodeUnknownSync(OutputFieldKey)("value")).toBe("value");
		for (const value of [""]) {
			expect(() => Schema.decodeUnknownSync(OutputFieldKey)(value)).toThrow();
		}
	});

	it("rejects malformed scalar expressions and legacy keys", () => {
		for (const expr of [
			{ values: [], type: "concat" },
			{
				bucket: "year",
				type: "dateBucket",
				timeZone: "America/New_York",
				expr: { type: "column", field: "createdAt", tableAlias: "entity" },
			},
			{ type: "transform", name: "titleCase", expression: { value: "value", type: "literal" } },
		]) {
			expect(() => Schema.decodeUnknownSync(RyotQLDocument)(makeDocument(expr))).toThrow();
		}
	});

	it("decodes grouped aggregate documents and responses", () => {
		const aggregate = {
			queries: {
				lessons: {
					from: { table: "entity", alias: "lesson" },
					output: {
						limit: 10,
						type: "aggregate",
						orderBy: [{ key: "count", direction: "desc" }],
						measures: [{ key: "count", aggregation: { function: "count" } }],
						groupBy: [
							{ key: "difficulty", expr: { field: "name", type: "column", tableAlias: "lesson" } },
						],
					},
				},
			},
		} as const;
		const response = {
			data: {
				lessons: {
					type: "aggregate",
					pageInfo: { limit: 10, hasMore: false },
					items: [
						{
							count: 2,
							active: true,
							optional: null,
							difficulty: "advanced",
							metadata: { source: "catalog" },
							createdAt: "2026-01-01T00:00:00.000Z",
						},
					],
				},
			},
		} as const;

		expect(Schema.decodeUnknownSync(RyotQLDocument)(aggregate)).toEqual(aggregate);
		expect(Schema.decodeUnknownSync(RyotQLResponse)(response)).toEqual(response);
	});

	it("rejects invalid aggregate output shapes", () => {
		const expr = { field: "id", type: "column", tableAlias: "lesson" } as const;
		const output = {
			type: "aggregate",
			measures: [{ key: "count", aggregation: { function: "count" } }],
		} as const;
		for (const invalid of [
			{ ...output, measures: [] },
			{ ...output, limit: 0 },
			{ ...output, orderBy: [] },
			{ ...output, unknown: true },
			{ ...output, groupBy: [{ type: "wildcard", tableAlias: "lesson" }] },
			{ ...output, measures: [{ key: "count", aggregation: { expr, function: "count" } }] },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(RyotQLDocument)({
					queries: { lessons: { output: invalid, from: { table: "entity", alias: "lesson" } } },
				}),
			).toThrow();
		}
	});

	it("decodes time-series documents and responses", () => {
		const timeSeries = {
			queries: {
				completions: {
					from: { table: "event", alias: "completion" },
					output: {
						type: "timeSeries",
						measure: { aggregation: { function: "count" } },
						time: {
							bucket: "day",
							expr: { type: "column", field: "occurredAt", tableAlias: "completion" },
							range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
						},
					},
				},
			},
		} as const;
		const response = {
			data: {
				completions: {
					type: "timeSeries",
					buckets: [
						{ value: 1, endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
					],
				},
			},
		} as const;

		expect(Schema.decodeUnknownSync(RyotQLDocument)(timeSeries)).toEqual(timeSeries);
		expect(Schema.decodeUnknownSync(RyotQLResponse)(response)).toEqual(response);
	});

	it("rejects invalid time-series output shapes", () => {
		const event = { table: "event", alias: "event" } as const;
		const time = {
			bucket: "day",
			expr: { type: "column", tableAlias: "event", field: "occurredAt" },
			range: { endAt: "2026-01-02T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
		} as const;
		for (const output of [
			{
				time,
				type: "timeSeries",
				measure: { aggregation: { expr: time.expr, function: "countDistinct" } },
			},
			{
				type: "timeSeries",
				time: { ...time, bucket: "year" },
				measure: { aggregation: { function: "count" } },
			},
			{ time, limit: 10, type: "timeSeries", measure: { aggregation: { function: "count" } } },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(RyotQLDocument)({ queries: { events: { output, from: event } } }),
			).toThrow();
		}
	});

	it("rejects malformed JSON paths, cast targets, and nested unknown keys", () => {
		const expression = { type: "column", field: "properties", tableAlias: "entity" };

		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ path: [], type: "jsonPath", expr: expression }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "cast", expr: expression, target: "integer" }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "cast", unsafe: true, target: "json", expr: expression }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "literal", value: Number.POSITIVE_INFINITY }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(makeDocument({ value: 1n, type: "literal" })),
		).toThrow();
	});

	it("uses the strict JSON-value contract for literals", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic["self"] = cyclic;

		for (const value of [new Date(0), Array(1), { [Symbol("value")]: true }, cyclic]) {
			expect(() =>
				Schema.decodeUnknownSync(RyotQLDocument)(makeDocument({ value, type: "literal" })),
			).toThrow();
		}
	});

	it("decodes nested correlated includes and their response values", () => {
		const withInclude = {
			queries: {
				courses: {
					...document.queries.collections,
					output: {
						...document.queries.collections.output,
						include: [
							{
								limit: 10,
								fields: [],
								key: "modules",
								from: { table: "relationship", alias: "courseModule" },
								orderBy: [
									{
										direction: "asc",
										expr: { field: "id", type: "column", tableAlias: "courseModule" },
									},
								],
								where: {
									operator: "eq",
									type: "comparison",
									right: { field: "id", type: "column", tableAlias: "collection" },
									left: { type: "column", field: "sourceEntityId", tableAlias: "courseModule" },
								},
							},
						],
					},
				},
			},
		} as const;
		expect(Schema.decodeUnknownSync(RyotQLDocument)(withInclude)).toEqual(withInclude);

		const response = {
			data: {
				courses: {
					type: "rows",
					pageInfo: { limit: 20, hasMore: false, nextCursor: null },
					items: [
						{
							active: false,
							id: "course-1",
							optional: null,
							metadata: { source: "catalog" },
							createdAt: "2026-01-01T00:00:00.000Z",
							modules: { items: [], pageInfo: { limit: 10, hasMore: false } },
						},
					],
				},
			},
		} as const;
		expect(Schema.decodeUnknownSync(RyotQLResponse)(response)).toEqual(response);
	});

	it("rejects present empty join and include collections", () => {
		for (const query of [
			{ ...document.queries.collections, joins: [] },
			{
				...document.queries.collections,
				output: { ...document.queries.collections.output, include: [] },
			},
		]) {
			expect(() => Schema.decodeUnknownSync(RyotQLDocument)({ queries: { query } })).toThrow();
		}

		const nested = {
			limit: 1,
			fields: [],
			key: "children",
			from: { alias: "child", table: "entity" },
			orderBy: [{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "child" } }],
		} as const;
		for (const invalid of [
			{ ...nested, joins: [] },
			{ ...nested, include: [] },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(RyotQLDocument)({
					queries: {
						query: {
							...document.queries.collections,
							output: { ...document.queries.collections.output, include: [invalid] },
						},
					},
				}),
			).toThrow();
		}
	});
});
