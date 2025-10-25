import { describe, expect, it } from "bun:test";

import { createEntityColumnExpression } from "@ryot/app-backend/query-language";

import {
	buildSavedViewQueryDocumentBody,
	createAuthenticatedClient,
	createRelationshipSchema,
	createSavedViewWithQueryDocument,
	createV2TrackerAndSchema,
	getSavedView,
	systemRef,
	updateSavedViewWithQueryDocument,
	type SavedViewQueryDocument,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

const rowsDocument: SavedViewQueryDocument = {
	version: 2,
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "rows",
		pagination: { page: 1, limit: 20 },
		fields: [{ key: "name", expr: systemRef("book", "name") }],
		orderBy: [{ order: "asc", expr: systemRef("book", "name") }],
	},
};

const aggregateDocument: SavedViewQueryDocument = {
	version: 2,
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		groupBy: [],
		type: "aggregate",
		measures: [{ key: "total", aggregation: { function: "count" } }],
	},
};

const timeSeriesDocument: SavedViewQueryDocument = {
	version: 2,
	source: { type: "entities", alias: "book", schemas: ["book"], where: null },
	output: {
		type: "timeSeries",
		measure: { aggregation: { function: "count" } },
		time: {
			bucket: "month",
			expr: systemRef("book", "createdAt"),
			range: { startAt: "2020-01-01T00:00:00.000Z", endAt: "2020-07-01T00:00:00.000Z" },
		},
	},
};

describe("Saved views v2 query documents E2E", () => {
	it("creates and retrieves a saved view backed by a v2 rows query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `V2 Rows View ${crypto.randomUUID()}`,
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.queryDocument).toEqual(rowsDocument);
		expect(fetchedView.queryDocument).toEqual(rowsDocument);
	});

	it("creates a saved view backed by a v2 aggregate query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, aggregateDocument, {
			name: `V2 Aggregate View ${crypto.randomUUID()}`,
		});

		expect(createdView.queryDocument).toEqual(aggregateDocument);
	});

	it("creates a saved view backed by a v2 time series query document", async () => {
		const { client } = await createAuthenticatedClient();

		const createdView = await createSavedViewWithQueryDocument(client, timeSeriesDocument, {
			name: `V2 Time Series View ${crypto.randomUUID()}`,
		});

		expect(createdView.queryDocument).toEqual(timeSeriesDocument);
	});

	it("updates a saved view's v2 query document", async () => {
		const { client } = await createAuthenticatedClient();
		const createdView = await createSavedViewWithQueryDocument(client, rowsDocument, {
			name: `Updatable V2 View ${crypto.randomUUID()}`,
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
		const { schemaId: courseSchemaId, slug: courseSlug } = await createV2TrackerAndSchema(client, {
			schemaName: `SavedViewCourse ${crypto.randomUUID()}`,
		});
		const { schemaId: moduleSchemaId, slug: moduleSlug } = await createV2TrackerAndSchema(client, {
			schemaName: `SavedViewModule ${crypto.randomUUID()}`,
		});
		const courseModuleSlug = `saved-view-course-module-${crypto.randomUUID()}`;
		await createRelationshipSchema(client, {
			slug: courseModuleSlug,
			name: "Saved View Course Module",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaId: courseSchemaId,
			targetEntitySchemaId: moduleSchemaId,
		});

		const hierarchicalDocument: SavedViewQueryDocument = {
			version: 2,
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
			name: `Hierarchical V2 View ${crypto.randomUUID()}`,
		});
		const fetchedView = await getSavedView(client, createdView.slug);

		expect(createdView.queryDocument).toEqual(hierarchicalDocument);
		expect(fetchedView.queryDocument).toEqual(hierarchicalDocument);
	});

	it("rejects a v2 query document that fails semantic validation even though queryDefinition is valid", async () => {
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
					name: `Invalid V2 View ${crypto.randomUUID()}`,
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Unknown source alias 'unknownAlias'");
	});

	it("rejects a legacy queryDefinition that fails validation even though queryDocument is valid", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewQueryDocumentBody(rowsDocument, {
					name: `Invalid Legacy Definition ${crypto.randomUUID()}`,
					queryDefinition: {
						filter: null,
						eventJoins: [],
						computedFields: [],
						scope: ["does-not-exist"],
						sort: {
							direction: "asc",
							expression: createEntityColumnExpression("does-not-exist", "name"),
						},
					},
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("not found");
	});
});
