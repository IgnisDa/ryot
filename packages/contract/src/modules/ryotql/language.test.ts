import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RyotQLDocument, RyotQLResponse } from "./language";

const document = {
	queries: {
		collections: {
			from: { table: "entity", alias: "collection" },
			output: {
				orderBy: [],
				type: "rows",
				pagination: { page: 1, limit: 20 },
				fields: [{ key: "id", expr: { type: "column", tableAlias: "collection", field: "id" } }],
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
				fields: [{ key: "value", expr }],
				pagination: { page: 1, limit: 20 },
			},
		},
	},
});

describe("RyotQLDocument", () => {
	it("decodes a named rows document", () => {
		expect(Schema.decodeUnknownSync(RyotQLDocument)(document)).toEqual(document);
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
						output: { ...document.queries.collections.output, pagination: { page: 0, limit: 20 } },
					},
				},
			}),
		).toThrow();
	});

	it("decodes recursive JSON and predicate expressions", () => {
		const properties = { type: "column", tableAlias: "entity", field: "properties" } as const;
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
								right: { type: "literal", value: 4 },
							},
							{ type: "isNotNull", expr: score },
						],
					},
					output: {
						type: "rows",
						pagination: { page: 1, limit: 20 },
						orderBy: [{ direction: "desc", expr: score }],
						fields: [
							{
								key: "score",
								expr: { type: "coalesce", values: [score, { type: "literal", value: 0 }] },
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
				right: { type: "column", tableAlias: "entity", field: "id" },
				left: { type: "column", tableAlias: "event", field: "entityId" },
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
						pagination: { page: 1, limit: 20 },
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
									right: { type: "literal", value: 2 },
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
							{ key: "difficulty", expr: { type: "column", tableAlias: "lesson", field: "name" } },
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
							count: { kind: "number", value: 2 },
							difficulty: { kind: "text", value: "advanced" },
						},
					],
				},
			},
		} as const;

		expect(Schema.decodeUnknownSync(RyotQLDocument)(aggregate)).toEqual(aggregate);
		expect(Schema.decodeUnknownSync(RyotQLResponse)(response)).toEqual(response);
	});

	it("rejects invalid aggregate output shapes", () => {
		const expr = { type: "column", tableAlias: "lesson", field: "id" } as const;
		const output = {
			type: "aggregate",
			measures: [{ key: "count", aggregation: { function: "count" } }],
		} as const;
		for (const invalid of [
			{ ...output, measures: [] },
			{ ...output, limit: 0 },
			{ ...output, orderBy: [] },
			{ ...output, unknown: true },
			{ ...output, measures: [{ key: "count", aggregation: { function: "count", expr } }] },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(RyotQLDocument)({
					queries: { lessons: { from: { table: "entity", alias: "lesson" }, output: invalid } },
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
							expr: { type: "column", tableAlias: "completion", field: "occurredAt" },
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
				measure: { aggregation: { function: "countDistinct", expr: time.expr } },
			},
			{
				type: "timeSeries",
				time: { ...time, bucket: "year" },
				measure: { aggregation: { function: "count" } },
			},
			{ time, type: "timeSeries", measure: { aggregation: { function: "count" } }, limit: 10 },
		]) {
			expect(() =>
				Schema.decodeUnknownSync(RyotQLDocument)({ queries: { events: { from: event, output } } }),
			).toThrow();
		}
	});

	it("rejects malformed JSON paths, cast targets, and nested unknown keys", () => {
		const expression = { type: "column", tableAlias: "entity", field: "properties" };

		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "jsonPath", path: [], expr: expression }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "cast", target: "integer", expr: expression }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "cast", target: "json", expr: expression, unsafe: true }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(
				makeDocument({ type: "literal", value: Number.POSITIVE_INFINITY }),
			),
		).toThrow();
		expect(() =>
			Schema.decodeUnknownSync(RyotQLDocument)(makeDocument({ type: "literal", value: 1n })),
		).toThrow();
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
										expr: { type: "column", tableAlias: "courseModule", field: "id" },
									},
								],
								where: {
									type: "comparison",
									operator: "eq",
									left: { type: "column", tableAlias: "courseModule", field: "sourceEntityId" },
									right: { type: "column", tableAlias: "collection", field: "id" },
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
					pageInfo: { page: 1, limit: 20, total: 1, hasMore: false },
					items: [
						{
							id: { kind: "text", value: "course-1" },
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
			from: { table: "entity", alias: "child" },
			orderBy: [{ direction: "asc", expr: { type: "column", tableAlias: "child", field: "id" } }],
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
