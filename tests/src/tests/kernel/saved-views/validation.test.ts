import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
} from "@ryot/contract/display-configuration";
import { Effect } from "effect";

import {
	buildSavedViewBody,
	buildUpdatedSavedViewBody,
	createAuthenticatedClient,
	createSavedView,
	entityField,
	postBackendJson,
} from "~/fixtures";
import { assertTaggedError, requireObjectRecord, requireString } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("saved views validation", () => {
	it.live("rejects a view with a null title property in the display config", () =>
		Effect.gen(function* () {
			const { cookies } = yield* createAuthenticatedClient();
			const createBody = buildSavedViewBody();
			const invalidTitleProperty = JSON.parse("null");

			const response = yield* Effect.promise(() =>
				postBackendJson(
					"/saved-views",
					{
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
					cookies,
				),
			);
			const error = requireObjectRecord(
				yield* Effect.promise(() => response.json()),
				"Expected BadRequest response",
			);
			const message = requireString(error.message, "Expected BadRequest message");

			expect(response.status).toBe(400);
			expect(requireString(error._tag, "Expected error tag")).toBe("BadRequest");
			expect(message).toContain("displayConfiguration");
			expect(message).toContain("titleProperty");
		}),
	);

	it.live("rejects a view with no table columns in the display config", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const error = yield* Effect.flip(
				client.call((c) =>
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
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("At least one table column is required");
		}),
	);

	it.live("rejects a view with an invalid built-in column in the display config", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createBody = buildSavedViewBody();

			const error = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: {
							...createBody,
							displayConfiguration: {
								...createBody.displayConfiguration,
								entityIdProperty: createEntityColumnExpression("book", "nam"),
							},
						},
					}),
				),
			);

			assertTaggedError(error, "BadRequest");
			expect(error.message).toContain("Unsupported entity column 'entity.book.nam'");
		}),
	);

	it.live("rejects a view referencing a property that does not exist in the schema", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const createBody = buildSavedViewBody();

			const createError = yield* Effect.flip(
				client.call((c) =>
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
				),
			);

			assertTaggedError(createError, "BadRequest");
			expect(createError.message).toContain(
				"Property 'missingProperty' not found in entity schema 'book'",
			);
		}),
	);

	it.live("rejects invalid entityIdProperty on create and update", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const invalidEntityIdProperty = JSON.parse('{"type":"literal","value":1}');

			const createBody = buildSavedViewBody();
			const createError = yield* Effect.flip(
				client.call((c) =>
					c.savedViews.create({
						payload: {
							...createBody,
							displayConfiguration: {
								...createBody.displayConfiguration,
								entityIdProperty: invalidEntityIdProperty,
							},
						},
					}),
				),
			);

			const createdView = yield* createSavedView(client);
			const updateBody = buildUpdatedSavedViewBody();
			const updateError = yield* Effect.flip(
				client.call((c) =>
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
				),
			);

			assertTaggedError(createError, "BadRequest");
			assertTaggedError(updateError, "BadRequest");
			expect(createError.message).toContain("entityIdProperty");
			expect(updateError.message).toContain("entityIdProperty");
			expect(createError.message).toContain("string expression");
			expect(updateError.message).toContain("string expression");
		}),
	);
});
