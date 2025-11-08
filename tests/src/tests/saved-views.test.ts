import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntitySchemaExpression,
} from "@ryot/app-backend/query-language";

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
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("Saved views query documents E2E", () => {
	it("stores media built-in saved views with canonical in-library filters", async () => {
		const { client } = await createAuthenticatedClient();
		const mediaTracker = await findBuiltinTrackerBySlug(client, "media");
		const views = await listSavedViews(client, { trackerId: mediaTracker.id });
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
	});

	it("creates and retrieves a saved view backed by a rows query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Rows View ${crypto.randomUUID()}`,
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.queryDocument).toEqual(rowsDocument);
		expect(fetchedView.queryDocument).toEqual(rowsDocument);
	});

	it("creates a saved view backed by an aggregate query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, aggregateDocument, {
			name: `Aggregate View ${crypto.randomUUID()}`,
		});

		expect(createdView.queryDocument).toEqual(aggregateDocument);
	});

	it("creates a saved view backed by a time series query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, timeSeriesDocument, {
			name: `Time Series View ${crypto.randomUUID()}`,
		});

		expect(createdView.queryDocument).toEqual(timeSeriesDocument);
	});

	it("updates a saved view's query document", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Updatable View ${crypto.randomUUID()}`,
		});

		const updatedView = await updateSavedViewWithQueryDocument(
			client,
			createdView.slug,
			aggregateDocument,
		);
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(updatedView.queryDocument).toEqual(aggregateDocument);
		expect(fetchedView.queryDocument).toEqual(aggregateDocument);
	});

	it("preserves a full v2 document with a where clause and nested includes without stripping fields", async () => {
		const { client } = await createAuthenticatedClient();
		const { schemaId: courseSchemaId, slug: courseSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: `SavedViewCourse ${crypto.randomUUID()}`,
			},
		);
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createQueryEngineTrackerAndSchema(
			client,
			{
				schemaName: `SavedViewModule ${crypto.randomUUID()}`,
			},
		);
		const courseModuleSlug = `saved-view-course-module-${crypto.randomUUID()}`;
		await createRelationshipSchema(client, {
			slug: courseModuleSlug,
			name: "Saved View Course Module",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: courseSchemaId,
			targetEntitySchemaId: moduleSchemaId,
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

		const createdView = await createSavedViewWithQueryDocument(client, hierarchicalDocument, {
			name: `Hierarchical View ${crypto.randomUUID()}`,
			displayConfiguration: {
				entityIdProperty: createEntityColumnExpression(courseSlug, "id"),
				table: { columns: [{ label: "Name", expression: [entityField(courseSlug, "name")] }] },
				grid: {
					imageProperty: [entityField(courseSlug, "image")],
					titleProperty: [entityField(courseSlug, "name")],
					eyebrowProperty: createEntitySchemaExpression("name"),
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
				list: {
					imageProperty: [entityField(courseSlug, "image")],
					titleProperty: [entityField(courseSlug, "name")],
					eyebrowProperty: createEntitySchemaExpression("name"),
					calloutProperty: null,
					primarySubtitleProperty: null,
					secondarySubtitleProperty: null,
				},
			},
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.queryDocument).toEqual(hierarchicalDocument);
		expect(fetchedView.queryDocument).toEqual(hierarchicalDocument);
	});

	it("rejects a query document that fails semantic validation", async () => {
		const { client } = await createAuthenticatedClient();
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

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Invalid View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Unknown source alias 'unknownAlias'");
	});

	it("rejects a query document with an unknown entity schema", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidDocument: SavedViewQueryDocument = {
			...rowsDocument,
			source: { ...rowsDocument.source, schemas: ["does-not-exist"] },
		};

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Unknown Entity Schema View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Entity schema 'does-not-exist' not found");
	});

	it("rejects a query document with an unknown event schema", async () => {
		const { client } = await createAuthenticatedClient();
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

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Unknown Event Schema View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Event schema 'does-not-exist' not found");
	});

	it("rejects a query document with an unknown relationship schema", async () => {
		const { client } = await createAuthenticatedClient();
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

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(invalidDocument, {
					name: `Unknown Relationship Schema View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Relationship schema 'does-not-exist' not found");
	});
});
