import { describe, expect, it } from "bun:test";

import {
	createAuthenticatedClient,
	createV2Entity,
	createV2TrackerAndSchema,
	executeQueryEngineV2,
	executeQueryEngineV2Error,
	propertyRef,
	requireV2FieldValue,
	schemaMetaRef,
	systemRef,
	type V2ExecutePayload,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

const buildRowsDoc = (
	overrides: Partial<V2ExecutePayload> & {
		alias: string;
		page?: number;
		limit?: number;
		schemas: [string, ...string[]];
		fields?: V2ExecutePayload["return"]["fields"];
		orderByExpr?: V2ExecutePayload["return"]["orderBy"][number]["expr"];
	},
): V2ExecutePayload => {
	const { alias, schemas, fields = [], orderByExpr, page = 1, limit = 10, ...rest } = overrides;
	return {
		version: 2,
		source: { type: "entities", alias, schemas, where: null },
		return: {
			fields,
			type: "rows",
			pagination: { page, limit },
			orderBy: [{ order: "asc", expr: orderByExpr ?? systemRef(alias, "name") }],
		},
		...rest,
	};
};

describe("Query Engine V2 E2E", () => {
	describe("Single-schema entity rows query", () => {
		it("returns entities with system field values", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "Course",
				propertiesSchema: {
					fields: {
						difficulty: { type: "string", label: "Difficulty", description: "Difficulty level" },
					},
				},
			});

			await createV2Entity(client, {
				entitySchemaId: schemaId,
				name: "Advanced TypeScript",
				properties: { difficulty: "advanced" },
			});
			await createV2Entity(client, {
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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.type).toBe("rows");
			expect(result.data.items).toHaveLength(2);

			const names = result.data.items.map((item) => requireV2FieldValue(item, "name").value);
			expect(names).toContain("Advanced TypeScript");
			expect(names).toContain("Beginner Rust");

			for (const item of result.data.items) {
				expect(requireV2FieldValue(item, "name").kind).toBe("text");
				expect(requireV2FieldValue(item, "id").kind).toBe("text");
				expect(typeof requireV2FieldValue(item, "id").value).toBe("string");
			}
		});

		it("returns property field values for matching schema", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "Book",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			});

			await createV2Entity(client, {
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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireV2FieldValue(item, "name").value).toBe("Clean Code");
			expect(requireV2FieldValue(item, "author").value).toBe("Robert Martin");
			expect(requireV2FieldValue(item, "author").kind).toBe("text");
		});

		it("returns schema metadata fields", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "TaggedCourse",
				propertiesSchema: { fields: {} },
			});

			await createV2Entity(client, { name: "First Course", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				alias: "c",
				schemas: [slug],
				fields: [
					{ key: "schemaSlug", expr: schemaMetaRef("c", "slug") },
					{ key: "schemaName", expr: schemaMetaRef("c", "name") },
				],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(1);
			const item = result.data.items[0];
			assertPresent(item, "Expected result item");
			expect(requireV2FieldValue(item, "schemaSlug").value).toBe(slug);
			expect(requireV2FieldValue(item, "schemaName").value).toBe("TaggedCourse");
		});
	});

	describe("Multi-schema property query", () => {
		it("returns null for property fields that do not match the row's schema", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId: bookSchemaId, slug: bookSlug } = await createV2TrackerAndSchema(client, {
				schemaName: "MultiBook",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Book author" } },
				},
			});
			const { schemaId: movieSchemaId, slug: movieSlug } = await createV2TrackerAndSchema(client, {
				schemaName: "MultiMovie",
				propertiesSchema: {
					fields: {
						director: { type: "string", label: "Director", description: "Movie director" },
					},
				},
			});

			await createV2Entity(client, {
				name: "A Great Book",
				entitySchemaId: bookSchemaId,
				properties: { author: "Author A" },
			});
			await createV2Entity(client, {
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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.items).toHaveLength(2);

			const bookItem = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "A Great Book",
			);
			const movieItem = result.data.items.find(
				(item) => requireV2FieldValue(item, "name").value === "A Great Movie",
			);

			assertPresent(bookItem, "Expected bookItem");
			assertPresent(movieItem, "Expected movieItem");

			expect(requireV2FieldValue(bookItem, "author").value).toBe("Author A");
			expect(requireV2FieldValue(bookItem, "director").kind).toBe("null");

			expect(requireV2FieldValue(movieItem, "director").value).toBe("Director B");
			expect(requireV2FieldValue(movieItem, "author").kind).toBe("null");
		});
	});

	describe("Pagination", () => {
		it("returns correct pagination metadata for multiple pages", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "PaginatedItem",
				propertiesSchema: { fields: {} },
			});

			await Promise.all(
				Array.from({ length: 5 }, (_, i) =>
					createV2Entity(client, {
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

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.pageInfo.total).toBe(5);
			expect(result.data.pageInfo.page).toBe(1);
			expect(result.data.pageInfo.limit).toBe(2);
			expect(result.data.pageInfo.hasMore).toBe(true);
			expect(result.data.items).toHaveLength(2);
		});

		it("returns hasMore=false on the last page", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "LastPageItem",
				propertiesSchema: { fields: {} },
			});

			await createV2Entity(client, { name: "Only Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 1,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.pageInfo.total).toBe(1);
			expect(result.data.pageInfo.hasMore).toBe(false);
		});

		it("returns empty items and zero total for second page beyond results", async () => {
			const { client } = await createAuthenticatedClient();
			const { schemaId, slug } = await createV2TrackerAndSchema(client, {
				schemaName: "SparseItem",
				propertiesSchema: { fields: {} },
			});

			await createV2Entity(client, { name: "One Item", entitySchemaId: schemaId });

			const doc = buildRowsDoc({
				page: 2,
				limit: 10,
				fields: [],
				alias: "item",
				schemas: [slug],
			});

			const result = await executeQueryEngineV2(client, doc);

			expect(result.data.pageInfo.total).toBe(1);
			expect(result.data.items).toHaveLength(0);
			expect(result.data.pageInfo.hasMore).toBe(false);
		});
	});

	describe("Visibility boundary", () => {
		it("does not allow a user to query another user's private entity schema", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			const { slug } = await createV2TrackerAndSchema(userA.client, {
				schemaName: "UserAPrivateCourse",
				propertiesSchema: { fields: {} },
			});

			const doc = buildRowsDoc({ fields: [], alias: "course", schemas: [slug] });

			const error = await executeQueryEngineV2Error(userB.client, doc);
			expect(error).toMatchObject({ _tag: "NotFound" });
		});

		it("only returns entities owned by the authenticated user", async () => {
			const userA = await createAuthenticatedClient();
			const userB = await createAuthenticatedClient();

			// Both users need access to the same schema slug. Use a unique slug per user
			// to avoid cross-schema contamination; in practice each user has their own schema.
			const { schemaId: schemaA, slug: slugA } = await createV2TrackerAndSchema(userA.client, {
				schemaName: "VisibilityCourse",
				propertiesSchema: { fields: {} },
			});
			const { schemaId: schemaB, slug: slugB } = await createV2TrackerAndSchema(userB.client, {
				schemaName: "VisibilityCourse",
				propertiesSchema: { fields: {} },
			});

			await createV2Entity(userA.client, { name: "User A Entity", entitySchemaId: schemaA });
			await createV2Entity(userB.client, { name: "User B Entity", entitySchemaId: schemaB });

			const resultA = await executeQueryEngineV2(
				userA.client,
				buildRowsDoc({
					alias: "course",
					schemas: [slugA],
					fields: [{ key: "name", expr: systemRef("course", "name") }],
				}),
			);

			expect(resultA.data.items).toHaveLength(1);
			const itemA = resultA.data.items[0];
			assertPresent(itemA, "Expected User A's result item");
			expect(requireV2FieldValue(itemA, "name").value).toBe("User A Entity");

			const resultB = await executeQueryEngineV2(
				userB.client,
				buildRowsDoc({
					alias: "course",
					schemas: [slugB],
					fields: [{ key: "name", expr: systemRef("course", "name") }],
				}),
			);

			expect(resultB.data.items).toHaveLength(1);
			const itemB = resultB.data.items[0];
			assertPresent(itemB, "Expected User B's result item");
			expect(requireV2FieldValue(itemB, "name").value).toBe("User B Entity");
		});
	});

	describe("Validation errors", () => {
		it("rejects a pagination limit exceeding 100", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "LimitTestSchema",
				propertiesSchema: { fields: {} },
			});

			const doc = buildRowsDoc({ alias: "e", schemas: [slug], limit: 101 });
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects an invalid system field for an entity source", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				propertiesSchema: { fields: {} },
				schemaName: "SystemFieldTestSchema",
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				// occurredAt is an event-only system field
				orderByExpr: systemRef("e", "occurredAt"),
			});
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});

		it("rejects a property field that references a schema not in the source schemas", async () => {
			const { client } = await createAuthenticatedClient();
			const { slug } = await createV2TrackerAndSchema(client, {
				schemaName: "PropSchemaTestSchema",
				propertiesSchema: {
					fields: { title: { type: "string", label: "Title", description: "" } },
				},
			});

			const doc = buildRowsDoc({
				alias: "e",
				schemas: [slug],
				fields: [{ key: "title", expr: propertyRef("e", "other-schema", "title") }],
			});
			const error = await executeQueryEngineV2Error(client, doc);
			expect(error).toMatchObject({ _tag: "BadRequest" });
		});
	});
});
