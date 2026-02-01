import { RemoteImageUrl } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	propertyRef,
	requireQueryEngineFieldValue,
	systemRef,
	createEntity,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("query engine field resolution", () => {
	const imageUrl = RemoteImageUrl.make("https://example.com/image.png");

	it.live("coalesces cross-schema property values per row", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const book = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "CoalesceBook",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Author" } },
				},
			});
			const movie = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "CoalesceMovie",
				propertiesSchema: {
					fields: { director: { type: "string", label: "Director", description: "Director" } },
				},
			});
			yield* createQueryEngineEntity(client, {
				name: "Book Row",
				entitySchemaId: book.schemaId,
				properties: { author: "Author A" },
			});
			yield* createQueryEngineEntity(client, {
				name: "Movie Row",
				entitySchemaId: movie.schemaId,
				properties: { director: "Director B" },
			});

			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "media",
					schemas: [book.slug, movie.slug],
					fields: [
						{ key: "name", expr: systemRef("media", "name") },
						{
							key: "creator",
							expr: {
								type: "coalesce",
								values: [
									propertyRef("media", book.slug, "author"),
									propertyRef("media", movie.slug, "director"),
								],
							},
						},
					],
				}),
			);

			const byName = new Map(
				result.data.items.map((item) => [requireQueryEngineFieldValue(item, "name").value, item]),
			);
			const bookRow = byName.get("Book Row");
			const movieRow = byName.get("Movie Row");
			assertPresent(bookRow, "Missing Book Row");
			assertPresent(movieRow, "Missing Movie Row");
			expect(requireQueryEngineFieldValue(bookRow, "creator").value).toBe("Author A");
			expect(requireQueryEngineFieldValue(movieRow, "creator").value).toBe("Director B");
		}),
	);

	it.live("returns the first image from the images property as json", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "ImageFieldItem",
				propertiesSchema: {
					fields: {
						images: {
							type: "array",
							label: "Images",
							description: "Images",
							items: {
								type: "object",
								label: "Item",
								description: "Item",
								unknownKeys: "strict",
								properties: {
									key: { type: "string", label: "Key", description: "Key" },
									url: { type: "string", label: "Url", description: "Url" },
									type: {
										type: "enum",
										label: "Type",
										description: "Type",
										options: ["s3", "remote"],
										validation: { required: true },
									},
								},
							},
						},
					},
				},
			});
			yield* createEntity(client, {
				name: "Image Entity",
				entitySchemaId: schemaId,
				properties: { images: [{ type: "remote", url: imageUrl }] },
			});

			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [slug],
					fields: [{ key: "image", expr: propertyRef("item", slug, "images", "0") }],
				}),
			);

			const imageRow = result.data.items[0];
			assertPresent(imageRow, "Missing image row");
			expect(requireQueryEngineFieldValue(imageRow, "image")).toEqual({
				kind: "json",
				value: { type: "remote", url: imageUrl },
			});
		}),
	);

	it.live("returns null wrappers for missing properties", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEngineTrackerAndSchema(client, {
				schemaName: "NullPropertyItem",
				propertiesSchema: {
					fields: { author: { type: "string", label: "Author", description: "Author" } },
				},
			});
			yield* createQueryEngineEntity(client, { name: "No Author", entitySchemaId: schemaId });

			const result = yield* executeQueryEngine(
				client,
				buildEntityRowsQueryDocument({
					alias: "item",
					schemas: [slug],
					fields: [{ key: "author", expr: propertyRef("item", slug, "author") }],
				}),
			);

			const authorRow = result.data.items[0];
			assertPresent(authorRow, "Missing null-property row");
			expect(requireQueryEngineFieldValue(authorRow, "author")).toEqual({
				kind: "null",
				value: null,
			});
		}),
	);
});
