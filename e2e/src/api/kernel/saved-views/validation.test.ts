import { aggregate, column, document, field, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	buildSavedViewBody,
	createAuthenticatedClient,
	entityBrowserSettings,
	rowsFields,
} from "~/fixtures/kernel";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const entity = table("entity", "entity");
const createError = Effect.fn(function* (
	overrides: Partial<ReturnType<typeof buildSavedViewBody>>,
) {
	const { client } = yield* createAuthenticatedClient();
	return yield* Effect.flip(
		client.call((c) => c.savedViews.create({ payload: buildSavedViewBody(overrides) })),
	);
});

type CreateSavedViewError = Effect.Success<ReturnType<typeof createError>>;

const expectSettingsError = (error: CreateSavedViewError, message: string) => {
	assertTaggedError(error, "SavedViewBadRequest");
	expect(error.reason).toEqual({ code: "settings-incompatible", message });
};

describe("saved views validation", () => {
	it.live("requires data sources for the entity-browser renderer", () =>
		Effect.gen(function* () {
			const error = yield* createError({ dataSources: null });
			expectSettingsError(error, "Entity-browser dataSources are required");
		}),
	);

	it.live("requires the configured source name to exist", () =>
		Effect.gen(function* () {
			const error = yield* createError({
				settings: { ...entityBrowserSettings, sourceName: "missing" },
			});
			expectSettingsError(error, "Entity-browser source 'missing' does not exist");
		}),
	);

	it.live("requires the configured source to produce rows", () =>
		Effect.gen(function* () {
			const error = yield* createError({
				dataSources: document({
					savedView: aggregate(entity, {
						measures: [{ key: "total", aggregation: { function: "count" } }],
					}),
				}),
			});
			expectSettingsError(error, "Entity-browser source 'savedView' must produce rows");
		}),
	);

	it.live("rejects stored cursors", () =>
		Effect.gen(function* () {
			const error = yield* createError({
				dataSources: document({
					savedView: rows(entity, { after: "cursor", limit: 2, fields: rowsFields }),
				}),
			});
			expectSettingsError(error, "Stored data source 'savedView' must not contain a cursor");
		}),
	);

	it.live("requires entity provenance fields to project canonical columns", () =>
		Effect.gen(function* () {
			const error = yield* createError({
				dataSources: document({
					savedView: rows(entity, {
						fields: [
							field("entityId", column(entity, "name")),
							field("ownerPluginId", column(entity, "entitySchemaPluginId")),
							field("entitySchemaSlug", column(entity, "entitySchemaSlug")),
						],
					}),
				}),
			});
			expectSettingsError(error, "Entity-browser field 'entityId' must project entity.id");
		}),
	);

	it.live("rejects inconsistent layout settings", () =>
		Effect.gen(function* () {
			const error = yield* createError({
				settings: { ...entityBrowserSettings, layouts: ["list"], defaultLayout: "grid" },
			});
			expectSettingsError(error, "Entity-browser defaultLayout must be one of the enabled layouts");
		}),
	);
});
