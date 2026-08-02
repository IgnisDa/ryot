import { column, inArray, literal, table } from "@ryot/ryotql";
import {
	buildSavedViewCountDocument,
	buildSavedViewDocument,
	decodeSavedViewCountResponse,
} from "@ryot/ryotql-recipes/saved-views";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntityFixture,
	createPluginEntitySchema,
	createSavedViewWithGridDocument,
	executeRyotQL,
	findBuiltinSchemaBySlug,
	getSavedView,
	insertLibraryMembership,
	requireRyotQLTextField,
	requireRows,
	rowsFields,
	seedMediaEntity,
} from "~/fixtures";
import { assertPresent, resultToEffect } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("saved views execution", () => {
	it.live("counts rows from a persisted saved-view query with its filter", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { pluginSlug, schemaId } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Count ${crypto.randomUUID()}`,
			});
			const matchingNames = [
				`Saved View Count Match One ${crypto.randomUUID()}`,
				`Saved View Count Match Two ${crypto.randomUUID()}`,
			];

			yield* Effect.all(
				[...matchingNames, `Saved View Count Other ${crypto.randomUUID()}`].map((name) =>
					createEntityFixture(client, { entitySchemaSlug: schemaId, name }),
				),
			);

			const entity = table("entity", "entity");
			const rowsQueryDocument = buildSavedViewDocument({
				fields: rowsFields,
				entitySchemaSlugs: [schemaId],
				where: inArray(
					column(entity, "name"),
					matchingNames.map((name) => literal(name)),
				),
			});
			const createdView = yield* createSavedViewWithGridDocument(client, rowsQueryDocument, {
				pluginSlug,
				entitySchemaSlug: schemaId,
				name: `Saved View Count ${crypto.randomUUID()}`,
			});
			const persistedView = yield* getSavedView(client, createdView.slug);
			const countDocument = buildSavedViewCountDocument(persistedView.layouts.grid.queryDocument);
			assertPresent(countDocument, "Expected a saved-view count document");

			const response = yield* executeRyotQL(client, countDocument);
			const total = yield* resultToEffect(decodeSavedViewCountResponse(response));

			expect(total).toBe(2);
		}),
	);

	it.live("executes a built-in all-shows view with per-user isolation", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(userA.client, "show");
			const providerId = schema.providers[0]?.providerId;
			assertPresent(providerId, "Expected a provider for the show schema");

			const entity = yield* seedMediaEntity({
				providerId,
				userId: null,
				entitySchemaSlug: schema.id,
				name: `Isolated All Shows ${crypto.randomUUID()}`,
				externalId: `isolated-all-shows-${crypto.randomUUID()}`,
				properties: {
					genres: [],
					images: [],
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 0,
					totalEpisodes: 0,
					description: null,
					publishYear: 2019,
					providerRating: 91.4,
					unlinkedCreators: [],
					productionStatus: "Ended",
				},
			});

			yield* insertLibraryMembership(userA.client, { mediaEntityId: entity.id });

			const userAView = yield* getSavedView(userA.client, "all-shows");
			const userBView = yield* getSavedView(userB.client, "all-shows");
			const userAResult = requireRows(
				(yield* executeRyotQL(userA.client, userAView.layouts.grid.queryDocument)).data.savedView,
				"savedView",
			);
			const userBResult = requireRows(
				(yield* executeRyotQL(userB.client, userBView.layouts.grid.queryDocument)).data.savedView,
				"savedView",
			);

			expect(userAResult.items.map((item) => requireRyotQLTextField(item, "title"))).toContain(
				entity.name,
			);
			expect(userBResult.items).toHaveLength(0);
		}),
	);
});
