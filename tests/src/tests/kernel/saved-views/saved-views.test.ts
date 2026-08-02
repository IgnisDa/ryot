import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/contract/display-configuration";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	include,
	isNotNull,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	buildSavedViewQueryDocumentBody,
	createAuthenticatedClient,
	createRelationshipSchema,
	createSavedViewWithQueryDocument,
	createPluginEntitySchema,
	entityField,
	findBuiltinPluginBySlug,
	getSavedView,
	listSavedViews,
	updateSavedViewWithQueryDocument,
	aggregateDocument,
	rowsDocument,
	timeSeriesDocument,
	type SavedViewQueryDocument,
} from "~/fixtures";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("Saved views query documents E2E", () => {
	it.live("stores media built-in saved views with canonical in-library filters", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const mediaPlugin = yield* findBuiltinPluginBySlug(client, "media");
			const views = yield* listSavedViews(client, { pluginSlug: mediaPlugin.slug });
			const allBooksView = views.find((view) => view.name === "All Books");

			expect(allBooksView?.queryDocument).toMatchObject({
				queries: {
					savedView: {
						from: { alias: "entity", table: "entity" },
						where: {
							type: "and",
							predicates: expect.arrayContaining([
								expect.objectContaining({
									type: "comparison",
									right: { type: "literal", value: "book" },
									left: expect.objectContaining({
										tableAlias: "entity",
										field: "entitySchemaSlug",
									}),
								}),
								expect.objectContaining({
									type: "exists",
									query: expect.objectContaining({
										from: { alias: "inLibrary", table: "relationship" },
									}),
								}),
							]),
						},
					},
				},
			});
		}),
	);

	it.live("creates and retrieves a saved view backed by a rows query document", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const createdView = yield* createSavedViewWithQueryDocument(client, rowsDocument, {
				name: `Rows View ${crypto.randomUUID()}`,
			});
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(createdView.queryDocument).toEqual(rowsDocument);
			expect(fetchedView.queryDocument).toEqual(rowsDocument);
		}),
	);

	it.live("creates a saved view backed by an aggregate query document", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const createdView = yield* createSavedViewWithQueryDocument(client, aggregateDocument, {
				name: `Aggregate View ${crypto.randomUUID()}`,
			});

			expect(createdView.queryDocument).toEqual(aggregateDocument);
		}),
	);

	it.live("creates a saved view backed by a time series query document", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const createdView = yield* createSavedViewWithQueryDocument(client, timeSeriesDocument, {
				name: `Time Series View ${crypto.randomUUID()}`,
			});

			expect(createdView.queryDocument).toEqual(timeSeriesDocument);
		}),
	);

	it.live("updates a saved view's query document", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createdView = yield* createSavedViewWithQueryDocument(client, rowsDocument, {
				name: `Updatable View ${crypto.randomUUID()}`,
			});

			const updatedView = yield* updateSavedViewWithQueryDocument(
				client,
				createdView.slug,
				aggregateDocument,
			);
			const fetchedView = yield* getSavedView(client, createdView.slug);

			expect(updatedView.queryDocument).toEqual(aggregateDocument);
			expect(fetchedView.queryDocument).toEqual(aggregateDocument);
		}),
	);

	it.live(
		"preserves a full RyotQL document with a where clause and nested includes without stripping fields",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId: courseSchemaId, slug: courseSlug } = yield* createPluginEntitySchema(
					client,
					{
						schemaName: `SavedViewCourse ${crypto.randomUUID()}`,
					},
				);
				const { schemaId: moduleSchemaId, slug: moduleSlug } = yield* createPluginEntitySchema(
					client,
					{
						schemaName: `SavedViewModule ${crypto.randomUUID()}`,
					},
				);
				const courseModuleSlug = `saved-view-course-module-${crypto.randomUUID()}`;
				yield* createRelationshipSchema(client, {
					slug: courseModuleSlug,
					name: "Saved View Course Module",
					sourceEntitySchemaSlug: courseSchemaId,
					targetEntitySchemaSlug: moduleSchemaId,
				});

				const course = table("entity", "course");
				const module = table("entity", "module");
				const courseModule = table("relationship", "courseModule");
				const hierarchicalDocument: SavedViewQueryDocument = document({
					savedView: rows(course, {
						where: and(
							eq(column(course, "entitySchemaSlug"), literal(courseSlug)),
							isNotNull(column(course, "name")),
						),
						fields: [field("name", column(course, "name"))],
						orderBy: [ascending(column(course, "name"))],
						limit: 10,
						include: [
							include(courseModule, {
								limit: 20,
								key: "modules",
								fields: [field("name", column(module, "name"))],
								orderBy: [ascending(column(module, "name"))],
								joins: [
									join(
										"inner",
										module,
										eq(column(courseModule, "targetEntityId"), column(module, "id")),
									),
								],
								where: and(
									eq(column(courseModule, "sourceEntityId"), column(course, "id")),
									eq(column(courseModule, "relationshipSchemaSlug"), literal(courseModuleSlug)),
									eq(column(module, "entitySchemaSlug"), literal(moduleSlug)),
								),
							}),
						],
					}),
				});

				const createdView = yield* createSavedViewWithQueryDocument(client, hierarchicalDocument, {
					name: `Hierarchical View ${crypto.randomUUID()}`,
					displayConfiguration: {
						entityIdProperty: createEntityColumnExpression(courseSlug, "id"),
						table: { columns: [{ label: "Name", expression: [entityField(courseSlug, "name")] }] },
						grid: {
							imageProperty: null,
							calloutProperty: null,
							primarySubtitleProperty: null,
							secondarySubtitleProperty: null,
							eyebrowProperty: createEntitySchemaExpression("name"),
							titleProperty: [entityField(courseSlug, "name")],
						},
						list: {
							imageProperty: null,
							calloutProperty: null,
							primarySubtitleProperty: null,
							secondarySubtitleProperty: null,
							eyebrowProperty: createEntitySchemaExpression("name"),
							titleProperty: [entityField(courseSlug, "name")],
						},
					},
				});
				const fetchedView = yield* getSavedView(client, createdView.slug);

				expect(createdView.queryDocument).toEqual(hierarchicalDocument);
				expect(fetchedView.queryDocument).toEqual(hierarchicalDocument);
			}),
	);

	it.live("rejects a query document that fails semantic validation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const unknown = table("entity", "unknownAlias");
			const book = table("entity", "book");
			const invalidDocument: SavedViewQueryDocument = document({
				savedView: rows(book, {
					fields: [],
					where: eq(column(unknown, "name"), literal("x")),
				}),
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: buildSavedViewQueryDocumentBody(invalidDocument, {
							name: `Invalid View ${crypto.randomUUID()}`,
						}),
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Unknown table alias 'unknownAlias'");
		}),
	);

	it.live("accepts unknown entity discriminator values as empty queries", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const book = table("entity", "book");
			const documentWithUnknownSchema: SavedViewQueryDocument = document({
				savedView: rows(book, {
					fields: [],
					where: eq(column(book, "entitySchemaSlug"), literal("does-not-exist")),
				}),
			});

			const createdView = yield* createSavedViewWithQueryDocument(
				client,
				documentWithUnknownSchema,
				{ name: `Unknown Entity Schema View ${crypto.randomUUID()}` },
			);

			expect(createdView.queryDocument).toEqual(documentWithUnknownSchema);
		}),
	);

	it.live("rejects a query document that selects a hidden field", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const savedView = table("savedView", "savedView");
			const invalidDocument: SavedViewQueryDocument = document({
				savedView: rows(savedView, {
					fields: [field("userId", column(savedView, "userId"))],
				}),
			});

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: buildSavedViewQueryDocumentBody(invalidDocument, {
							name: `Hidden Field View ${crypto.randomUUID()}`,
						}),
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Unknown field 'userId' on table 'saved_view'");
		}),
	);
});
