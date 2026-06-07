import { describe, expect, it } from "bun:test";

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
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

describe("Single-schema entity rows query", () => {
	it("returns entities with system field values", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "Course",
			propertiesSchema: {
				fields: {
					difficulty: { type: "string", label: "Difficulty", description: "Difficulty level" },
				},
			},
		});

		await createQueryEngineEntity(client, {
			entitySchemaId: schemaId,
			name: "Advanced TypeScript",
			properties: { difficulty: "advanced" },
		});
		await createQueryEngineEntity(client, {
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

		const result = await executeQueryEngine(client, doc);

		expect(result.type).toBe("rows");
		expect(result.data.items).toHaveLength(2);

		const names = result.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value);
		expect(names).toContain("Advanced TypeScript");
		expect(names).toContain("Beginner Rust");

		for (const item of result.data.items) {
			expect(requireQueryEngineFieldValue(item, "name").kind).toBe("text");
			expect(requireQueryEngineFieldValue(item, "id").kind).toBe("text");
			expect(typeof requireQueryEngineFieldValue(item, "id").value).toBe("string");
		}
	});

	it("returns property field values for matching schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "Book",
			propertiesSchema: {
				fields: { author: { type: "string", label: "Author", description: "Book author" } },
			},
		});

		await createQueryEngineEntity(client, {
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

		const result = await executeQueryEngine(client, doc);

		expect(result.data.items).toHaveLength(1);
		const item = result.data.items[0];
		assertPresent(item, "Expected result item");
		expect(requireQueryEngineFieldValue(item, "name").value).toBe("Clean Code");
		expect(requireQueryEngineFieldValue(item, "author").value).toBe("Robert Martin");
		expect(requireQueryEngineFieldValue(item, "author").kind).toBe("text");
	});

	it("returns schema metadata fields", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "TaggedCourse",
		});

		await createQueryEngineEntity(client, { name: "First Course", entitySchemaId: schemaId });

		const doc = buildRowsDoc({
			alias: "c",
			schemas: [slug],
			fields: [
				{ key: "schemaSlug", expr: schemaMetaRef("c", "slug") },
				{ key: "schemaName", expr: schemaMetaRef("c", "name") },
			],
		});

		const result = await executeQueryEngine(client, doc);

		expect(result.data.items).toHaveLength(1);
		const item = result.data.items[0];
		assertPresent(item, "Expected result item");
		expect(requireQueryEngineFieldValue(item, "schemaSlug").value).toBe(slug);
		expect(requireQueryEngineFieldValue(item, "schemaName").value).toBe("TaggedCourse");
	});
});

describe("Multi-schema property query", () => {
	it("returns null for property fields that do not match the row's schema", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: bookSchemaId, slug: bookSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: "MultiBook",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			},
		);
		const { schemaId: movieSchemaId, slug: movieSlug } = await createQueryEngineTrackerAndSchema(
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

		await createQueryEngineEntity(client, {
			name: "A Great Book",
			entitySchemaId: bookSchemaId,
			properties: { author: "Author A" },
		});
		await createQueryEngineEntity(client, {
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

		const result = await executeQueryEngine(client, doc);

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
	});
});

describe("Pagination", () => {
	it("returns correct pagination metadata for multiple pages", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "PaginatedItem",
		});

		await Promise.all(
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

		const result = await executeQueryEngine(client, doc);

		expect(result.data.pageInfo.total).toBe(5);
		expect(result.data.pageInfo.page).toBe(1);
		expect(result.data.pageInfo.limit).toBe(2);
		expect(result.data.pageInfo.hasMore).toBe(true);
		expect(result.data.items).toHaveLength(2);
	});

	it("returns hasMore=false on the last page", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "LastPageItem",
		});

		await createQueryEngineEntity(client, { name: "Only Item", entitySchemaId: schemaId });

		const doc = buildRowsDoc({
			page: 1,
			limit: 10,
			fields: [],
			alias: "item",
			schemas: [slug],
		});

		const result = await executeQueryEngine(client, doc);

		expect(result.data.pageInfo.total).toBe(1);
		expect(result.data.pageInfo.hasMore).toBe(false);
	});

	it("returns empty items and zero total for second page beyond results", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
			schemaName: "SparseItem",
		});

		await createQueryEngineEntity(client, { name: "One Item", entitySchemaId: schemaId });

		const doc = buildRowsDoc({
			page: 2,
			limit: 10,
			fields: [],
			alias: "item",
			schemas: [slug],
		});

		const result = await executeQueryEngine(client, doc);

		expect(result.data.pageInfo.total).toBe(0);
		expect(result.data.items).toHaveLength(0);
		expect(result.data.pageInfo.hasMore).toBe(false);
	});
});
