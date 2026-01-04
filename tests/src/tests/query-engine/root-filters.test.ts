import { Effect } from "effect";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	literalExpr,
	propertyRef,
	type QueryEngineRowsResponse,
	requireQueryEngineFieldValue,
	systemRef,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

type Expr = ReturnType<typeof literalExpr>;

const compare = (
	operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
	left: Expr,
	right: Expr,
): Expr => ({ type: "comparison", operator, left, right });
const andW = (a: Expr, b: Expr): Expr => ({ type: "and", values: [a, b] });
const orW = (a: Expr, b: Expr): Expr => ({ type: "or", values: [a, b] });
const containsW = (left: Expr, right: Expr): Expr => ({ type: "contains", left, right });
const isNullW = (expr: Expr): Expr => ({ type: "isNull", expr });
const isNotNullW = (expr: Expr): Expr => ({ type: "isNotNull", expr });
const notW = (expr: Expr): Expr => ({ type: "not", expr });

const namesOf = (result: QueryEngineRowsResponse) =>
	result.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value);

const setupItems = () =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
			schemaName: "RootFilterItem",
			propertiesSchema: {
				fields: {
					difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
					durationMinutes: { type: "integer", label: "Duration", description: "Duration minutes" },
					archived: { type: "boolean", label: "Archived", description: "Archived flag" },
				},
			},
		});
		yield* Effect.all([
			createQueryEngineEntity(client, {
				name: "Alpha",
				entitySchemaSlug: schemaId,
				properties: { difficulty: "beginner", durationMinutes: 30, archived: false },
			}),
			createQueryEngineEntity(client, {
				name: "Bravo",
				entitySchemaSlug: schemaId,
				properties: { difficulty: "advanced", durationMinutes: 60, archived: true },
			}),
			createQueryEngineEntity(client, {
				name: "Charlie",
				entitySchemaSlug: schemaId,
				properties: { difficulty: "advanced", durationMinutes: 90, archived: false },
			}),
			createQueryEngineEntity(client, {
				name: "Delta",
				entitySchemaSlug: schemaId,
				properties: { difficulty: "beginner", durationMinutes: 120, archived: true },
			}),
			createQueryEngineEntity(client, { name: "Echo", entitySchemaSlug: schemaId, properties: {} }),
		]);
		return { client, slug };
	});

const buildDoc = (slug: string, where: Expr, page?: number, limit?: number) =>
	buildEntityRowsQueryDocument({
		page,
		limit,
		where,
		alias: "item",
		schemas: [slug],
		fields: [{ key: "name", expr: systemRef("item", "name") }],
	});

describe("Query engine root property filters", () => {
	it.live("filters by a string property equality", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					compare("eq", propertyRef("item", slug, "difficulty"), literalExpr("advanced")),
				),
			);
			expect(namesOf(result)).toEqual(["Bravo", "Charlie"]);
			expect(result.data.pageInfo.total).toBe(2);
		}),
	);

	it.live("filters by a numeric property with a greater-than comparison", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					compare("gt", propertyRef("item", slug, "durationMinutes"), literalExpr(60)),
				),
			);
			expect(namesOf(result)).toEqual(["Charlie", "Delta"]);
		}),
	);

	it.live("filters by a numeric property with a gte comparison (boundary inclusive)", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					compare("gte", propertyRef("item", slug, "durationMinutes"), literalExpr(60)),
				),
			);
			expect(namesOf(result)).toEqual(["Bravo", "Charlie", "Delta"]);
		}),
	);

	it.live("preserves operand order when the literal is on the left", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			// 60 < durationMinutes  ==  durationMinutes > 60
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					compare("lt", literalExpr(60), propertyRef("item", slug, "durationMinutes")),
				),
			);
			expect(namesOf(result)).toEqual(["Charlie", "Delta"]);
		}),
	);

	it.live("filters by a boolean property equality", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const archivedTrue = yield* executeQueryEngine(
				client,
				buildDoc(slug, compare("eq", propertyRef("item", slug, "archived"), literalExpr(true))),
			);
			expect(namesOf(archivedTrue)).toEqual(["Bravo", "Delta"]);

			const archivedFalse = yield* executeQueryEngine(
				client,
				buildDoc(slug, compare("eq", propertyRef("item", slug, "archived"), literalExpr(false))),
			);
			expect(namesOf(archivedFalse)).toEqual(["Alpha", "Charlie"]);
		}),
	);

	it.live("filters by a case-insensitive substring contains", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const lower = yield* executeQueryEngine(
				client,
				buildDoc(slug, containsW(propertyRef("item", slug, "difficulty"), literalExpr("vanc"))),
			);
			expect(namesOf(lower)).toEqual(["Bravo", "Charlie"]);

			const upper = yield* executeQueryEngine(
				client,
				buildDoc(slug, containsW(propertyRef("item", slug, "difficulty"), literalExpr("ADVAN"))),
			);
			expect(namesOf(upper)).toEqual(["Bravo", "Charlie"]);
		}),
	);

	it.live("filters by isNull / isNotNull on a property (missing value reads as null)", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const missing = yield* executeQueryEngine(
				client,
				buildDoc(slug, isNullW(propertyRef("item", slug, "durationMinutes"))),
			);
			expect(namesOf(missing)).toEqual(["Echo"]);

			const present = yield* executeQueryEngine(
				client,
				buildDoc(slug, isNotNullW(propertyRef("item", slug, "durationMinutes"))),
			);
			expect(namesOf(present)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
		}),
	);

	it.live("combines predicates with AND", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					andW(
						compare("eq", propertyRef("item", slug, "difficulty"), literalExpr("advanced")),
						compare("gt", propertyRef("item", slug, "durationMinutes"), literalExpr(60)),
					),
				),
			);
			expect(namesOf(result)).toEqual(["Charlie"]);
		}),
	);

	it.live("combines predicates with OR", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					orW(
						compare("eq", propertyRef("item", slug, "difficulty"), literalExpr("advanced")),
						compare("lt", propertyRef("item", slug, "durationMinutes"), literalExpr(40)),
					),
				),
			);
			expect(namesOf(result)).toEqual(["Alpha", "Bravo", "Charlie"]);
		}),
	);

	it.live("reports the correct total and page window for a filtered, paginated query", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const pageOne = yield* executeQueryEngine(
				client,
				buildDoc(slug, isNotNullW(propertyRef("item", slug, "durationMinutes")), 1, 2),
			);
			expect(namesOf(pageOne)).toEqual(["Alpha", "Bravo"]);
			expect(pageOne.data.pageInfo.total).toBe(4);
			expect(pageOne.data.pageInfo.hasMore).toBe(true);

			const pageTwo = yield* executeQueryEngine(
				client,
				buildDoc(slug, isNotNullW(propertyRef("item", slug, "durationMinutes")), 2, 2),
			);
			expect(namesOf(pageTwo)).toEqual(["Charlie", "Delta"]);
			expect(pageTwo.data.pageInfo.total).toBe(4);
			expect(pageTwo.data.pageInfo.hasMore).toBe(false);
		}),
	);

	it.live(
		"does not match rows of other schemas when filtering a multi-schema source by a schema-qualified property",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const ratingSchema = {
					fields: { rating: { type: "integer" as const, label: "Rating", description: "Rating" } },
				};
				const { schemaId: bookSchemaId, slug: bookSlug } = yield* createQueryEngineTrackerAndSchema(
					client,
					{ schemaName: "MultiFilterBook", propertiesSchema: ratingSchema },
				);
				const { schemaId: movieSchemaId, slug: movieSlug } =
					yield* createQueryEngineTrackerAndSchema(client, {
						schemaName: "MultiFilterMovie",
						propertiesSchema: ratingSchema,
					});
				yield* Effect.all([
					createQueryEngineEntity(client, {
						name: "HighBook",
						entitySchemaSlug: bookSchemaId,
						properties: { rating: 8 },
					}),
					createQueryEngineEntity(client, {
						name: "LowBook",
						entitySchemaSlug: bookSchemaId,
						properties: { rating: 3 },
					}),
					createQueryEngineEntity(client, {
						name: "HighMovie",
						entitySchemaSlug: movieSchemaId,
						properties: { rating: 9 },
					}),
				]);

				const result = yield* executeQueryEngine(
					client,
					buildEntityRowsQueryDocument({
						alias: "item",
						limit: 20,
						schemas: [bookSlug, movieSlug],
						fields: [{ key: "name", expr: systemRef("item", "name") }],
						where: compare("gte", propertyRef("item", bookSlug, "rating"), literalExpr(5)),
					}),
				);

				expect(namesOf(result)).toEqual(["HighBook"]);
			}),
	);

	it.live("compiles neq with null-as-false (null-valued rows are excluded)", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					compare("neq", propertyRef("item", slug, "difficulty"), literalExpr("advanced")),
				),
			);
			expect(namesOf(result)).toEqual(["Alpha", "Delta"]);
		}),
	);

	it.live("compiles not(eq) as a double negation that keeps null-valued rows", () =>
		Effect.gen(function* () {
			const { client, slug } = yield* setupItems();
			const result = yield* executeQueryEngine(
				client,
				buildDoc(
					slug,
					notW(compare("eq", propertyRef("item", slug, "difficulty"), literalExpr("advanced"))),
				),
			);
			expect(namesOf(result)).toEqual(["Alpha", "Delta", "Echo"]);
		}),
	);

	it.live('orders text under COLLATE "C" (uppercase before lowercase, byte order)', () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "CollationItem",
			});
			yield* Effect.all(
				["apple", "Banana", "Cherry"].map((name) =>
					createQueryEngineEntity(client, { name, entitySchemaSlug: schemaId }),
				),
			);
			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "item",
					limit: 20,
					schemas: [slug],
					fields: [{ key: "name", expr: systemRef("item", "name") }],
				}),
			);
			expect(namesOf(result)).toEqual(["Banana", "Cherry", "apple"]);
		}),
	);
});
