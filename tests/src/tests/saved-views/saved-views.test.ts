import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/contract/display-configuration";
import { Effect } from "effect";

import {
	buildSavedViewQueryDocumentBody,
	createAuthenticatedClient,
	createRelationshipSchema,
	createSavedViewWithQueryDocument,
	createQueryEngineTrackerAndSchema,
	entityField,
	findBuiltinTrackerBySlug,
	getSavedView,
	listSavedViews,
	systemRef,
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
			const mediaTracker = yield* findBuiltinTrackerBySlug(client, "media");
			const views = yield* listSavedViews(client, { trackerSlug: mediaTracker.id });
			const allBooksView = views.find((view) => view.name === "All Books");

			expect(allBooksView?.queryDocument).toMatchObject({
				source: {
					schemas: ["book"],
					where: {
						type: "exists",
						source: {
							alias: "library",
							type: "entities",
							schemas: ["library"],
							via: { entityRef: "entity", schema: "in-library" },
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
		"preserves a full v2 document with a where clause and nested includes without stripping fields",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const { schemaId: courseSchemaId, slug: courseSlug } =
					yield* createQueryEngineTrackerAndSchema(client, {
						schemaName: `SavedViewCourse ${crypto.randomUUID()}`,
					});
				const { schemaId: moduleSchemaId, slug: moduleSlug } =
					yield* createQueryEngineTrackerAndSchema(client, {
						schemaName: `SavedViewModule ${crypto.randomUUID()}`,
					});
				const courseModuleSlug = `saved-view-course-module-${crypto.randomUUID()}`;
				yield* createRelationshipSchema(client, {
					slug: courseModuleSlug,
					name: "Saved View Course Module",
					sourceEntitySchemaSlug: courseSchemaId,
					targetEntitySchemaSlug: moduleSchemaId,
				});

				const hierarchicalDocument: SavedViewQueryDocument = {
					source: {
						alias: "course",
						type: "entities",
						schemas: [courseSlug],
						where: { type: "isNotNull", expr: systemRef("course", "name") },
					},
					output: {
						type: "rows",
						pagination: { page: 1, limit: 10 },
						fields: [{ key: "name", expr: systemRef("course", "name") }],
						orderBy: [{ order: "asc", expr: systemRef("course", "name") }],
						include: [
							{
								limit: 20,
								key: "modules",
								fields: [{ key: "name", expr: systemRef("module", "name") }],
								orderBy: [{ order: "asc", expr: systemRef("module", "name") }],
								source: {
									alias: "module",
									type: "entities",
									schemas: [moduleSlug],
									where: null,
									via: {
										entityRef: "course",
										alias: "courseModule",
										direction: "outgoing",
										schema: courseModuleSlug,
									},
								},
							},
						],
					},
				};

				const createdView = yield* createSavedViewWithQueryDocument(client, hierarchicalDocument, {
					name: `Hierarchical View ${crypto.randomUUID()}`,
					displayConfiguration: {
						entityIdProperty: createEntityColumnExpression(courseSlug, "id"),
						table: { columns: [{ label: "Name", expression: [entityField(courseSlug, "name")] }] },
						grid: {
							imageProperty: null,
							titleProperty: [entityField(courseSlug, "name")],
							eyebrowProperty: createEntitySchemaExpression("name"),
							calloutProperty: null,
							primarySubtitleProperty: null,
							secondarySubtitleProperty: null,
						},
						list: {
							imageProperty: null,
							titleProperty: [entityField(courseSlug, "name")],
							eyebrowProperty: createEntitySchemaExpression("name"),
							calloutProperty: null,
							primarySubtitleProperty: null,
							secondarySubtitleProperty: null,
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
			const invalidDocument: SavedViewQueryDocument = {
				...rowsDocument,
				source: {
					...rowsDocument.source,
					where: {
						operator: "eq",
						type: "comparison",
						right: { type: "literal", value: "x" },
						left: {
							type: "ref",
							sourceAlias: "unknownAlias",
							field: { type: "system", name: "name" },
						},
					},
				},
			};

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
			expect(error.message).toContain("Unknown source alias 'unknownAlias'");
		}),
	);

	it.live("rejects a query document with an unknown entity schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const invalidDocument: SavedViewQueryDocument = {
				...rowsDocument,
				source: { ...rowsDocument.source, schemas: ["does-not-exist"] },
			};

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: buildSavedViewQueryDocumentBody(invalidDocument, {
							name: `Unknown Entity Schema View ${crypto.randomUUID()}`,
						}),
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Entity schema 'does-not-exist' not found");
		}),
	);

	it.live("rejects a query document with an unknown event schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const invalidDocument: SavedViewQueryDocument = {
				...rowsDocument,
				source: {
					...rowsDocument.source,
					where: {
						type: "exists",
						source: {
							where: null,
							alias: "event",
							type: "events",
							entityRef: "book",
							schemas: ["does-not-exist"],
						},
					},
				},
			};

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: buildSavedViewQueryDocumentBody(invalidDocument, {
							name: `Unknown Event Schema View ${crypto.randomUUID()}`,
						}),
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Event schema 'does-not-exist' not found");
		}),
	);

	it.live("rejects a query document with an unknown relationship schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const invalidDocument: SavedViewQueryDocument = {
				...rowsDocument,
				output: {
					type: "rows",
					pagination: { page: 1, limit: 20 },
					fields: [{ key: "name", expr: systemRef("book", "name") }],
					orderBy: [{ order: "asc", expr: systemRef("book", "name") }],
					include: [
						{
							limit: 1,
							key: "related",
							fields: [{ key: "name", expr: systemRef("relatedBook", "name") }],
							orderBy: [{ order: "asc", expr: systemRef("relatedBook", "name") }],
							source: {
								where: null,
								alias: "relatedBook",
								type: "entities",
								schemas: ["book"],
								via: {
									entityRef: "book",
									alias: "related",
									direction: "outgoing",
									schema: "does-not-exist",
								},
							},
						},
					],
				},
			};

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: buildSavedViewQueryDocumentBody(invalidDocument, {
							name: `Unknown Relationship Schema View ${crypto.randomUUID()}`,
						}),
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Relationship schema 'does-not-exist' not found");
		}),
	);
});
