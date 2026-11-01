import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { PluginId } from "../../schema/brands";
import {
	mapPluginIdentityReferences,
	OutputFieldKey,
	Pagination,
	RyotQLDocument,
	RyotQLResponse,
} from "./language";

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

const epoch = new Date(0);

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
	it.effect("decodes a named rows document", () =>
		Effect.gen(function* () {
			expect(yield* Schema.decodeEffect(RyotQLDocument)(document)).toEqual(document);
		}),
	);

	it.effect("decodes wildcard row selections", () =>
		Effect.gen(function* () {
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
			expect(yield* Schema.decodeEffect(RyotQLDocument)(wildcard)).toEqual(wildcard);
		}),
	);

	it.effect("rejects unknown keys throughout the document", () =>
		Effect.flip(
			Schema.decodeUnknownEffect(RyotQLDocument)({
				...document,
				queries: { collections: { ...document.queries.collections, authority: "admin" } },
			}),
		),
	);

	it.effect("rejects invalid pagination", () =>
		Effect.flip(
			Schema.decodeEffect(RyotQLDocument)({
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
		),
	);

	it.effect("decodes recursive JSON and predicate expressions", () =>
		Effect.gen(function* () {
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

			expect(yield* Schema.decodeEffect(RyotQLDocument)(complex)).toEqual(complex);
		}),
	);

	it.effect("decodes correlated query and arithmetic expressions", () =>
		Effect.gen(function* () {
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

			expect(yield* Schema.decodeEffect(RyotQLDocument)(correlated)).toEqual(correlated);
		}),
	);

	it.effect("decodes scalar operations with recursive expressions and predicates", () =>
		Effect.gen(function* () {
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
				{ bucket: "year", expr: createdAt, type: "dateBucket", timeZone: "America/New_York" },
				{ expr: createdAt, type: "localDate", timeZone: "America/New_York" },
				{ expr: createdAt, type: "localHour", timeZone: "America/New_York" },
				{ type: "currentDate" },
			] as const;

			for (const expr of expressions) {
				expect(yield* Schema.decodeUnknownEffect(RyotQLDocument)(makeDocument(expr))).toEqual(
					makeDocument(expr),
				);
			}
		}),
	);

	it.effect("exports positive cursor pagination and non-empty output field-key schemas", () =>
		Effect.gen(function* () {
			expect(yield* Schema.decodeEffect(Pagination)({ limit: 20, after: "cursor" })).toEqual({
				limit: 20,
				after: "cursor",
			});
			expect(yield* Schema.decodeEffect(OutputFieldKey)("value")).toBe("value");
			for (const value of [""]) {
				yield* Effect.flip(Schema.decodeEffect(OutputFieldKey)(value));
			}
		}),
	);

	it.effect("rejects malformed scalar expressions and legacy keys", () =>
		Effect.gen(function* () {
			for (const expr of [
				{ values: [], type: "concat" },
				{
					bucket: "quarter",
					type: "dateBucket",
					timeZone: "America/New_York",
					expr: { type: "column", field: "createdAt", tableAlias: "entity" },
				},
				{ type: "transform", name: "titleCase", expression: { value: "value", type: "literal" } },
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(RyotQLDocument)(makeDocument(expr)));
			}
		}),
	);

	it.effect("decodes grouped aggregate documents and responses", () =>
		Effect.gen(function* () {
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
								{
									key: "difficulty",
									expr: { field: "name", type: "column", tableAlias: "lesson" },
								},
							],
						},
					},
				},
			} as const;
			const response = {
				data: {
					lessons: {
						type: "aggregate",
						pageInfo: { limit: 10, hasMore: false, nextCursor: null },
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

			expect(yield* Schema.decodeEffect(RyotQLDocument)(aggregate)).toEqual(aggregate);
			expect(yield* Schema.decodeEffect(RyotQLResponse)(response)).toEqual(response);
		}),
	);

	it.effect("rejects invalid aggregate output shapes", () =>
		Effect.gen(function* () {
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
				yield* Effect.flip(
					Schema.decodeUnknownEffect(RyotQLDocument)({
						queries: { lessons: { output: invalid, from: { table: "entity", alias: "lesson" } } },
					}),
				);
			}
		}),
	);

	it.effect("rejects malformed JSON paths, cast targets, and nested unknown keys", () =>
		Effect.gen(function* () {
			const expression = { type: "column", field: "properties", tableAlias: "entity" };

			yield* Effect.flip(
				Schema.decodeUnknownEffect(RyotQLDocument)(
					makeDocument({ path: [], type: "jsonPath", expr: expression }),
				),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(RyotQLDocument)(
					makeDocument({ type: "cast", expr: expression, target: "integer" }),
				),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(RyotQLDocument)(
					makeDocument({ type: "cast", unsafe: true, target: "json", expr: expression }),
				),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(RyotQLDocument)(
					makeDocument({ type: "literal", value: Number.POSITIVE_INFINITY }),
				),
			);
			yield* Effect.flip(
				Schema.decodeUnknownEffect(RyotQLDocument)(makeDocument({ value: 1n, type: "literal" })),
			);
		}),
	);

	it.effect("uses the strict JSON-value contract for literals", () =>
		Effect.gen(function* () {
			const cyclic: Record<string, unknown> = {};
			cyclic["self"] = cyclic;

			for (const value of [epoch, Array(1), { [Symbol("value")]: true }, cyclic]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(RyotQLDocument)(makeDocument({ value, type: "literal" })),
				);
			}
		}),
	);

	it.effect("decodes nested correlated includes and their response values", () =>
		Effect.gen(function* () {
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
			expect(yield* Schema.decodeEffect(RyotQLDocument)(withInclude)).toEqual(withInclude);

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
			expect(yield* Schema.decodeEffect(RyotQLResponse)(response)).toEqual(response);
		}),
	);

	it.effect("decodes JSON elements joins and maps plugin identities in their expressions", () =>
		Effect.gen(function* () {
			const elements = {
				mode: "inner",
				alias: "element",
				type: "jsonElements",
				expr: {
					type: "conditional",
					whenFalse: { value: null, type: "literal" },
					condition: { type: "isNotNull", expr: { type: "pluginId", reference: { kind: "self" } } },
					whenTrue: {
						path: ["items"],
						type: "jsonPath",
						expr: { type: "column", field: "properties", tableAlias: "collection" },
					},
				},
			} as const;
			const withElements = {
				queries: { collections: { ...document.queries.collections, joins: [elements] } },
			} as const;
			const decoded = yield* Schema.decodeEffect(RyotQLDocument)(withElements);
			expect(decoded).toEqual(withElements);
			const leftElements = {
				queries: {
					collections: { ...document.queries.collections, joins: [{ ...elements, mode: "left" }] },
				},
			} as const;
			expect(yield* Schema.decodeEffect(RyotQLDocument)(leftElements)).toEqual(leftElements);

			const local = { kind: "local", pluginId: PluginId.make("plugin-a") } as const;
			expect(mapPluginIdentityReferences(decoded, () => local)).toMatchObject({
				queries: {
					collections: {
						joins: [{ expr: { condition: { expr: { type: "pluginId", reference: local } } } }],
					},
				},
			});
			const localDateDocument = yield* Schema.decodeUnknownEffect(RyotQLDocument)(
				makeDocument({
					timeZone: "UTC",
					type: "localDate",
					expr: {
						type: "conditional",
						whenTrue: { type: "currentDate" },
						whenFalse: { type: "currentDate" },
						condition: {
							operator: "eq",
							type: "comparison",
							right: { type: "literal", value: "plugin-a" },
							left: { type: "pluginId", reference: { kind: "self" } },
						},
					},
				}),
			);
			expect(mapPluginIdentityReferences(localDateDocument, () => local)).toMatchObject({
				queries: {
					entities: {
						output: { fields: [{ expr: { expr: { condition: { left: { reference: local } } } } }] },
					},
				},
			});

			for (const join of [
				{ ...elements, on: { type: "and", predicates: [] } },
				{ mode: "inner", alias: "element", type: "jsonElements" },
				{ mode: "inner", expr: elements.expr, type: "jsonElements" },
				{ alias: "element", expr: elements.expr, type: "jsonElements" },
				{ ...elements, mode: "outer" },
				{ ...elements, type: "cross" },
			]) {
				yield* Effect.flip(
					Schema.decodeUnknownEffect(RyotQLDocument)({
						queries: { collections: { ...document.queries.collections, joins: [join] } },
					}),
				);
			}
		}),
	);

	it.effect("rejects present empty join and include collections", () =>
		Effect.gen(function* () {
			for (const query of [
				{ ...document.queries.collections, joins: [] },
				{
					...document.queries.collections,
					output: { ...document.queries.collections.output, include: [] },
				},
			]) {
				yield* Effect.flip(Schema.decodeUnknownEffect(RyotQLDocument)({ queries: { query } }));
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
				yield* Effect.flip(
					Schema.decodeEffect(RyotQLDocument)({
						queries: {
							query: {
								...document.queries.collections,
								output: { ...document.queries.collections.output, include: [invalid] },
							},
						},
					}),
				);
			}
		}),
	);
});
