import { aggregate, document, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	buildSavedViewBody,
	createAuthenticatedClient,
	entityBrowserSettings,
	rowsFields,
} from "~/fixtures/kernel";
import { postApiJson } from "~/fixtures/kernel/contract-client";
import { findMediaEntitySchema } from "~/fixtures/plugins/media";
import { assertTaggedError } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const entity = table("entity", "entity");
const createError = Effect.fn(function* (
	overrides: (
		pluginId: Parameters<typeof buildSavedViewBody>[0],
	) => Parameters<typeof buildSavedViewBody>[1],
) {
	const { client } = yield* createAuthenticatedClient();
	const { pluginId } = yield* findMediaEntitySchema(client, "book");
	return yield* Effect.flip(
		client.call((c) =>
			c.savedViews.create({ payload: buildSavedViewBody(pluginId, overrides(pluginId)) }),
		),
	);
});

type CreateSavedViewError = Effect.Success<ReturnType<typeof createError>>;

const expectSettingsError = (error: CreateSavedViewError) => {
	assertTaggedError(error, "SavedViewBadRequest");
	expect(error.reason.code).toBe("settings-incompatible");
};

describe("saved views validation", () => {
	it.live("requires the configured source name to exist", () =>
		Effect.gen(function* () {
			const error = yield* createError((pluginId) => ({
				settings: { ...entityBrowserSettings(pluginId), sourceName: "missing" },
			}));
			expectSettingsError(error);
		}),
	);

	it.live("requires the configured source to produce rows", () =>
		Effect.gen(function* () {
			const error = yield* createError((pluginId) => ({
				settings: { ...entityBrowserSettings(pluginId), controls: {} },
				dataSources: document({
					savedView: aggregate(entity, {
						measures: [{ key: "total", aggregation: { function: "count" } }],
					}),
				}),
			}));
			expectSettingsError(error);
		}),
	);

	it.live("rejects stored cursors", () =>
		Effect.gen(function* () {
			const { token, client } = yield* createAuthenticatedClient();
			const { pluginId } = yield* findMediaEntitySchema(client, "book");
			const query = rows(entity, { limit: 2, fields: rowsFields });
			const invalidOutput = { ...query.output, after: "cursor" };
			const response = yield* postApiJson(
				client,
				"/saved-views",
				buildSavedViewBody(pluginId, {
					dataSources: { queries: { savedView: { ...query, output: invalidOutput } } },
				}),
				token,
			);
			expect(response.status).toBe(400);
		}),
	);

	it.live("requires the subject alias to be an entity table in the source query", () =>
		Effect.gen(function* () {
			const error = yield* createError((pluginId) => {
				const settings = entityBrowserSettings(pluginId);
				return {
					settings: { ...settings, subject: { ...settings.subject, entityAlias: "missing" } },
				};
			});
			expectSettingsError(error);
		}),
	);

	it.live("rejects duplicate subject schemas", () =>
		Effect.gen(function* () {
			const error = yield* createError((pluginId) => {
				const settings = entityBrowserSettings(pluginId);
				const [schema] = settings.subject.schemas;
				return {
					settings: { ...settings, subject: { ...settings.subject, schemas: [schema, schema] } },
				};
			});
			expectSettingsError(error);
		}),
	);

	it.live("rejects inconsistent layout settings", () =>
		Effect.gen(function* () {
			const error = yield* createError((pluginId) => ({
				settings: { ...entityBrowserSettings(pluginId), layouts: ["list"], defaultLayout: "grid" },
			}));
			expectSettingsError(error);
		}),
	);
});
