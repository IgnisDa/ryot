import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { EntityBrowserSavedViewSettings } from "@ryot-app/contract/modules/saved-views/schemas";
import { column, inArray, literal, table } from "@ryot-app/ryotql";
import { savedViewCountRecipe } from "@ryot-app/ryotql-recipes/saved-views";
import { Effect, Schema } from "effect";

import {
	buildSavedViewDataSources,
	createAuthenticatedClient,
	createEntityFixture,
	createPluginEntitySchema,
	createSavedView,
	executeRyotQLRecipe,
	findBuiltinSchemaBySlug,
	getSavedView,
} from "~/fixtures/kernel";
import { insertLibraryMembership, seedMediaEntity } from "~/fixtures/plugins/media";
import { assertPresent, requirePresent, resultToEffect } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const countSavedView = Effect.fn(function* (
	client: Parameters<typeof executeRyotQLRecipe>[0],
	view: {
		readonly dataSources: RyotQLDocument | null;
		readonly settings: Readonly<Record<string, unknown>>;
	},
) {
	const settings = yield* Schema.decodeUnknownEffect(EntityBrowserSavedViewSettings)(view.settings);
	const dataSources = requirePresent(view.dataSources, "Saved view has no data sources");
	const recipe = yield* resultToEffect(savedViewCountRecipe(dataSources, settings.entityIdField));
	return yield* executeRyotQLRecipe(client, recipe);
});

describe("saved views execution", () => {
	it.live("counts rows from the persisted data source and its filter", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, pluginSlug } = yield* createPluginEntitySchema(client, {
				schemaName: `Saved View Count ${crypto.randomUUID()}`,
			});
			const matchingNames = [
				`Saved View Count Match One ${crypto.randomUUID()}`,
				`Saved View Count Match Two ${crypto.randomUUID()}`,
			];
			yield* Effect.forEach(
				[...matchingNames, `Saved View Count Other ${crypto.randomUUID()}`],
				(name) => createEntityFixture(client, { name, entitySchemaSlug: schemaId }),
			);

			const entity = table("entity", "entity");
			const base = buildSavedViewDataSources([schemaId]);
			const query = requirePresent(base.queries.savedView, "Saved-view query is missing");
			const dataSources = {
				...base,
				queries: {
					...base.queries,
					savedView: {
						...query,
						where: inArray(
							column(entity, "name"),
							matchingNames.map((name) => literal(name)),
						),
					},
				},
			};
			const created = yield* createSavedView(client, {
				dataSources,
				workspacePluginSlug: pluginSlug,
				name: `Saved View Count ${crypto.randomUUID()}`,
			});
			const persisted = yield* getSavedView(client, created.slug);

			expect(yield* countSavedView(client, persisted)).toBe(2);
		}),
	);

	it.live("executes a built-in data source with per-user isolation", () =>
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
			expect(yield* countSavedView(userA.client, userAView)).toBe(1);
			expect(yield* countSavedView(userB.client, userBView)).toBe(0);
		}),
	);
});
