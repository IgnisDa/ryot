import { describe, expect, it } from "bun:test";

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
} from "../fixtures";

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

const setupItems = async () => {
	const { client } = await createAuthenticatedClient();
	const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
		schemaName: "RootFilterItem",
		propertiesSchema: {
			fields: {
				difficulty: { type: "string", label: "Difficulty", description: "Difficulty" },
				durationMinutes: { type: "integer", label: "Duration", description: "Duration minutes" },
				archived: { type: "boolean", label: "Archived", description: "Archived flag" },
			},
		},
	});
	await Promise.all([
		createQueryEngineEntity(client, {
			name: "Alpha",
			entitySchemaId: schemaId,
			properties: { difficulty: "beginner", durationMinutes: 30, archived: false },
		}),
		createQueryEngineEntity(client, {
			name: "Bravo",
			entitySchemaId: schemaId,
			properties: { difficulty: "advanced", durationMinutes: 60, archived: true },
		}),
		createQueryEngineEntity(client, {
			name: "Charlie",
			entitySchemaId: schemaId,
			properties: { difficulty: "advanced", durationMinutes: 90, archived: false },
		}),
		createQueryEngineEntity(client, {
			name: "Delta",
			entitySchemaId: schemaId,
			properties: { difficulty: "beginner", durationMinutes: 120, archived: true },
		}),
		// Echo has no properties, so difficulty/durationMinutes/archived read as null.
		createQueryEngineEntity(client, { name: "Echo", entitySchemaId: schemaId, properties: {} }),
	]);
	return { client, slug };
};

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
	it("filters by a string property equality", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
			client,
			buildDoc(
				slug,
				compare("eq", propertyRef("item", slug, "difficulty"), literalExpr("advanced")),
			),
		);
		expect(namesOf(result)).toEqual(["Bravo", "Charlie"]);
		expect(result.data.pageInfo.total).toBe(2);
	});

	it("filters by a numeric property with a greater-than comparison", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
			client,
			buildDoc(slug, compare("gt", propertyRef("item", slug, "durationMinutes"), literalExpr(60))),
		);
		expect(namesOf(result)).toEqual(["Charlie", "Delta"]);
	});

	it("filters by a numeric property with a gte comparison (boundary inclusive)", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
			client,
			buildDoc(slug, compare("gte", propertyRef("item", slug, "durationMinutes"), literalExpr(60))),
		);
		expect(namesOf(result)).toEqual(["Bravo", "Charlie", "Delta"]);
	});

	it("preserves operand order when the literal is on the left", async () => {
		const { client, slug } = await setupItems();
		// 60 < durationMinutes  ==  durationMinutes > 60
		const result = await executeQueryEngine(
			client,
			buildDoc(slug, compare("lt", literalExpr(60), propertyRef("item", slug, "durationMinutes"))),
		);
		expect(namesOf(result)).toEqual(["Charlie", "Delta"]);
	});

	it("filters by a boolean property equality", async () => {
		const { client, slug } = await setupItems();
		const archivedTrue = await executeQueryEngine(
			client,
			buildDoc(slug, compare("eq", propertyRef("item", slug, "archived"), literalExpr(true))),
		);
		expect(namesOf(archivedTrue)).toEqual(["Bravo", "Delta"]);

		const archivedFalse = await executeQueryEngine(
			client,
			buildDoc(slug, compare("eq", propertyRef("item", slug, "archived"), literalExpr(false))),
		);
		expect(namesOf(archivedFalse)).toEqual(["Alpha", "Charlie"]);
	});

	it("filters by a case-insensitive substring contains", async () => {
		const { client, slug } = await setupItems();
		const lower = await executeQueryEngine(
			client,
			buildDoc(slug, containsW(propertyRef("item", slug, "difficulty"), literalExpr("vanc"))),
		);
		expect(namesOf(lower)).toEqual(["Bravo", "Charlie"]);

		const upper = await executeQueryEngine(
			client,
			buildDoc(slug, containsW(propertyRef("item", slug, "difficulty"), literalExpr("ADVAN"))),
		);
		expect(namesOf(upper)).toEqual(["Bravo", "Charlie"]);
	});

	it("filters by isNull / isNotNull on a property (missing value reads as null)", async () => {
		const { client, slug } = await setupItems();
		const missing = await executeQueryEngine(
			client,
			buildDoc(slug, isNullW(propertyRef("item", slug, "durationMinutes"))),
		);
		expect(namesOf(missing)).toEqual(["Echo"]);

		const present = await executeQueryEngine(
			client,
			buildDoc(slug, isNotNullW(propertyRef("item", slug, "durationMinutes"))),
		);
		expect(namesOf(present)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
	});

	it("combines predicates with AND", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
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
	});

	it("combines predicates with OR", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
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
	});

	it("reports the correct total and page window for a filtered, paginated query", async () => {
		const { client, slug } = await setupItems();
		const pageOne = await executeQueryEngine(
			client,
			buildDoc(slug, isNotNullW(propertyRef("item", slug, "durationMinutes")), 1, 2),
		);
		expect(namesOf(pageOne)).toEqual(["Alpha", "Bravo"]);
		expect(pageOne.data.pageInfo.total).toBe(4);
		expect(pageOne.data.pageInfo.hasMore).toBe(true);

		const pageTwo = await executeQueryEngine(
			client,
			buildDoc(slug, isNotNullW(propertyRef("item", slug, "durationMinutes")), 2, 2),
		);
		expect(namesOf(pageTwo)).toEqual(["Charlie", "Delta"]);
		expect(pageTwo.data.pageInfo.total).toBe(4);
		expect(pageTwo.data.pageInfo.hasMore).toBe(false);
	});

	it("does not match rows of other schemas when filtering a multi-schema source by a schema-qualified property", async () => {
		const { client } = await createAuthenticatedClient();
		const ratingSchema = {
			fields: { rating: { type: "integer" as const, label: "Rating", description: "Rating" } },
		};
		const { schemaId: bookSchemaId, slug: bookSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "MultiFilterBook", propertiesSchema: ratingSchema },
		);
		const { schemaId: movieSchemaId, slug: movieSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{ schemaName: "MultiFilterMovie", propertiesSchema: ratingSchema },
		);
		await Promise.all([
			createQueryEngineEntity(client, {
				name: "HighBook",
				entitySchemaId: bookSchemaId,
				properties: { rating: 8 },
			}),
			createQueryEngineEntity(client, {
				name: "LowBook",
				entitySchemaId: bookSchemaId,
				properties: { rating: 3 },
			}),
			createQueryEngineEntity(client, {
				name: "HighMovie",
				entitySchemaId: movieSchemaId,
				properties: { rating: 9 },
			}),
		]);

		const result = await executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				alias: "item",
				limit: 20,
				schemas: [bookSlug, movieSlug],
				fields: [{ key: "name", expr: systemRef("item", "name") }],
				where: compare("gte", propertyRef("item", bookSlug, "rating"), literalExpr(5)),
			}),
		);

		// Only book rows are matched: the movie row's schema does not match the property's schema,
		// so its value reads as null and is excluded even though its rating is >= 5.
		expect(namesOf(result)).toEqual(["HighBook"]);
	});

	it("compiles neq with null-as-false (null-valued rows are excluded)", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
			client,
			buildDoc(
				slug,
				compare("neq", propertyRef("item", slug, "difficulty"), literalExpr("advanced")),
			),
		);
		// Bravo/Charlie are advanced (excluded); Echo's difficulty is null so `neq` is false (excluded).
		expect(namesOf(result)).toEqual(["Alpha", "Delta"]);
	});

	it("compiles not(eq) as a double negation that keeps null-valued rows", async () => {
		const { client, slug } = await setupItems();
		const result = await executeQueryEngine(
			client,
			buildDoc(
				slug,
				notW(compare("eq", propertyRef("item", slug, "difficulty"), literalExpr("advanced"))),
			),
		);
		// eq is false for Echo (null), and NOT false is true — so Echo is kept, unlike neq above.
		expect(namesOf(result)).toEqual(["Alpha", "Delta", "Echo"]);
	});

	it('orders text under COLLATE "C" (uppercase before lowercase, byte order)', async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "CollationItem",
		});
		await Promise.all(
			["apple", "Banana", "Cherry"].map((name) =>
				createQueryEngineEntity(client, { name, entitySchemaId: schemaId }),
			),
		);
		const result = await executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				alias: "item",
				limit: 20,
				schemas: [slug],
				fields: [{ key: "name", expr: systemRef("item", "name") }],
			}),
		);
		expect(namesOf(result)).toEqual(["Banana", "Cherry", "apple"]);
	});
});
