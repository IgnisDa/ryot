import { describe, expect, it } from "bun:test";

import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/app-backend/query-language";

import {
	buildSavedViewBody,
	buildUpdatedSavedViewBody,
	createAuthenticatedClient,
	createSavedView,
	entityField,
} from "../fixtures";
import { assertTaggedError } from "../test-support/assertions";

describe("saved views validation", () => {
	it("rejects a view with a null title property in the display config", async () => {
		const { client } = await createAuthenticatedClient();
		const createBody = buildSavedViewBody();
		const invalidTitleProperty = JSON.parse("null");

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: {
					...createBody,
					displayConfiguration: {
						...createBody.displayConfiguration,
						grid: {
							...createBody.displayConfiguration.grid,
							titleProperty: invalidTitleProperty,
						},
						list: {
							...createBody.displayConfiguration.list,
							titleProperty: invalidTitleProperty,
						},
					},
				},
			}),
		);

		assertTaggedError(error, "ParseError");
		expect(error.message).toContain("displayConfiguration");
		expect(error.message).toContain("titleProperty");
	});

	it("rejects a view with no table columns in the display config", async () => {
		const { client } = await createAuthenticatedClient();

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: buildSavedViewBody({
					displayConfiguration: {
						table: { columns: [] },
						grid: {
							imageProperty: null,
							calloutProperty: null,
							eyebrowProperty: null,
							primarySubtitleProperty: null,
							secondarySubtitleProperty: null,
							titleProperty: [entityField("book", "name")],
						},
						list: {
							imageProperty: null,
							calloutProperty: null,
							eyebrowProperty: null,
							primarySubtitleProperty: null,
							secondarySubtitleProperty: null,
							titleProperty: [entityField("book", "name")],
						},
					},
				}),
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("At least one table column is required");
	});

	it("rejects a view with an invalid built-in column in the display config", async () => {
		const { client } = await createAuthenticatedClient();
		const createBody = buildSavedViewBody();

		const error = await client.runError((c) =>
			c.savedViews.create({
				payload: {
					...createBody,
					displayConfiguration: {
						...createBody.displayConfiguration,
						entityIdProperty: createEntityColumnExpression("book", "nam"),
					},
				},
			}),
		);

		assertTaggedError(error, "BadRequest");
		expect(error.message).toContain("Unsupported entity column 'entity.book.nam'");
	});

	it("rejects a view referencing a property that does not exist in the schema", async () => {
		const { client } = await createAuthenticatedClient();
		const createBody = buildSavedViewBody();

		const createError = await client.runError((c) =>
			c.savedViews.create({
				payload: {
					...createBody,
					displayConfiguration: {
						...createBody.displayConfiguration,
						grid: {
							...createBody.displayConfiguration.grid,
							titleProperty: createEntityPropertyExpression("book", "missingProperty"),
						},
					},
				},
			}),
		);

		assertTaggedError(createError, "BadRequest");
		expect(createError.message).toContain(
			"Property 'missingProperty' not found in entity schema 'book'",
		);
	});

	it("rejects invalid entityIdProperty on create and update", async () => {
		const { client } = await createAuthenticatedClient();
		const invalidEntityIdProperty = JSON.parse('{"type":"literal","value":1}');

		const createBody = buildSavedViewBody();
		const createError = await client.runError((c) =>
			c.savedViews.create({
				payload: {
					...createBody,
					displayConfiguration: {
						...createBody.displayConfiguration,
						entityIdProperty: invalidEntityIdProperty,
					},
				},
			}),
		);

		const createdView = await createSavedView(client);
		const updateBody = buildUpdatedSavedViewBody();
		const updateError = await client.runError((c) =>
			c.savedViews.update({
				path: { viewSlug: createdView.slug },
				payload: {
					...updateBody,
					displayConfiguration: {
						...updateBody.displayConfiguration,
						entityIdProperty: invalidEntityIdProperty,
					},
				},
			}),
		);

		assertTaggedError(createError, "BadRequest");
		assertTaggedError(updateError, "BadRequest");
		expect(createError.message).toContain("entityIdProperty");
		expect(updateError.message).toContain("entityIdProperty");
		expect(createError.message).toContain("string expression");
		expect(updateError.message).toContain("string expression");
	});
});
