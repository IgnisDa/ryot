import { Effect } from "effect";

import {
	buildRowsDoc,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	propertyRef,
	requireQueryEngineFieldValue,
	schemaMetaRef,
	systemRef,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Single-schema entity rows query", () => {
	it.live("returns entities with system field values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "Course",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty level" },
					},
				},
			});

			yield* createQueryEngineEntity(client, {
				entitySchemaId: schemaId,
				name: "Advanced TypeScript",
				properties: { difficulty: "advanced" },
			});
			yield* createQueryEngineEntity(client, {
				name: "Beginner Rust",
				entitySchemaId: schemaId,
				properties: { difficulty: "beginner" },
			});

			const doc = buildRowsDoc({
				alias: "course",
				schemas: [slug],
				fields: [
					{ key: "name", expr: systemRef("course", "name") },
					{ key: "id", expr: systemRef("course", "id") },
				],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.type).toBe("rows");
			expect(result.data.items).toHaveLength(2);

			const names = result.data.items.map(
				(item) => requireQueryEngineFieldValue(item, "name").value,
			);
			expect(names).toContain("Advanced TypeScript");
			expect(names).toContain("Beginner Rust");

			for (const item of result.data.items) {
				expect(requireQueryEngineFieldValue(item, "name").kind).toBe("text");
				expect(requireQueryEngineFieldValue(item, "id").kind).toBe("text");
				expect(typeof requireQueryEngineFieldValue(item, "id").value).toBe("string");
			}
		}),
	);

	it.live("returns property field values for matching schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "Book",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			});

			yield* createQueryEngineEntity(client, {
				name: "Clean Code",
				entitySchemaId: schemaId,
				properties: { author: "Robert Martin" },
			});

			const doc = buildRowsDoc({
				alias: "book",
				schemas: [slug],
				fields: [
					{ key: "name", expr: systemRef("book", "name") },
					{ key: "author", expr: propertyRef("book", slug, "author") },
				],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireQueryEngineFieldValue(item, "name").value).toBe("Clean Code");
			expect(requireQueryEngineFieldValue(item, "author").value).toBe("Robert Martin");
			expect(requireQueryEngineFieldValue(item, "author").kind).toBe("text");
		}),
	);

	it.live("returns schema metadata fields", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "TaggedCourse",
			});

			yield* createQueryEngineEntity(client, { name: "First Course", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				alias: "c",
				schemas: [slug],
				fields: [
					{ key: "schemaSlug", expr: schemaMetaRef("c", "slug") },
					{ key: "schemaName", expr: schemaMetaRef("c", "name") },
				],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireQueryEngineFieldValue(item, "schemaSlug").value).toBe(slug);
			expect(requireQueryEngineFieldValue(item, "schemaName").value).toBe("TaggedCourse");
		}),
	);
});

describe("Multi-schema property query", () => {
	it.live("returns null for property fields that do not match the row's schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId: bookSchemaId, slug: bookSlug } = yield* createQueryEngineTrackerAndSchema(
				client,
				{
					schemaName: "MultiBook",
					propertiesSchema: {
						fields: { author: { type: "string", label: "Author", description: "Book author" } },
					},
				},
			);
			const { schemaId: movieSchemaId, slug: movieSlug } = yield* createQueryEngineTrackerAndSchema(
				client,
				{
					schemaName: "MultiMovie",
					propertiesSchema: {
						fields: {
							director: { type: "string", label: "Director", description: "Movie director" },
						},
					},
				},
			);

			yield* createQueryEngineEntity(client, {
				name: "A Great Book",
				entitySchemaId: bookSchemaId,
				properties: { author: "Author A" },
			});
			yield* createQueryEngineEntity(client, {
				name: "A Great Movie",
				entitySchemaId: movieSchemaId,
				properties: { director: "Director B" },
			});

			const doc = buildRowsDoc({
				alias: "media",
				schemas: [bookSlug, movieSlug],
				fields: [
					{ key: "name", expr: systemRef("media", "name") },
					{ key: "author", expr: propertyRef("media", bookSlug, "author") },
					{ key: "director", expr: propertyRef("media", movieSlug, "director") },
				],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.items).toHaveLength(2);

			const bookItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "A Great Book",
			);
			const movieItem = result.data.items.find(
				(item) => requireQueryEngineFieldValue(item, "name").value === "A Great Movie",
			);

			assertPresent(bookItem, "Expected bookItem");
			assertPresent(movieItem, "Expected movieItem");

			expect(requireQueryEngineFieldValue(bookItem, "author").value).toBe("Author A");
			expect(requireQueryEngineFieldValue(bookItem, "director").kind).toBe("null");

			expect(requireQueryEngineFieldValue(movieItem, "director").value).toBe("Director B");
			expect(requireQueryEngineFieldValue(movieItem, "author").kind).toBe("null");
		}),
	);
});

describe("Pagination", () => {
	it.live("returns correct pagination metadata for multiple pages", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "PaginatedItem",
			});

			yield* Effect.all(
				Array.from({ length: 5 }, (_, i) =>
					createQueryEngineEntity(client, {
						entitySchemaId: schemaId,
						name: `Item ${String(i + 1).padStart(2, "0")}`,
					}),
				),
			);

			const doc = buildRowsDoc({
				page: 1,
				limit: 2,
				alias: "item",
				schemas: [slug],
				fields: [{ key: "name", expr: systemRef("item", "name") }],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(5);
			expect(result.data.pageInfo.page).toBe(1);
			expect(result.data.pageInfo.limit).toBe(2);
			expect(result.data.pageInfo.hasMore).toBe(true);
			expect(result.data.items).toHaveLength(2);
		}),
	);

	it.live("returns hasMore=false on the last page", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "LastPageItem",
			});

			yield* createQueryEngineEntity(client, { name: "Only Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 1,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(1);
			expect(result.data.pageInfo.hasMore).toBe(false);
		}),
	);

	it.live("returns empty items and zero total for second page beyond results", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "SparseItem",
			});

			yield* createQueryEngineEntity(client, { name: "One Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 2,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = yield* executeQueryEngine(client, doc);

			expect(result.data.pageInfo.total).toBe(0);
			expect(result.data.items).toHaveLength(0);
			expect(result.data.pageInfo.hasMore).toBe(false);
		}),
	);
});
