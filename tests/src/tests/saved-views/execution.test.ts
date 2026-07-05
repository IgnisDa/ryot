import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getFirstProviderScriptId,
	getSavedView,
	insertLibraryMembership,
	requireQueryEngineFieldValue,
	seedMediaEntity,
} from "~/fixtures";
import { describe, expect, it } from "~/support/effect-test";

describe("saved views execution", () => {
	it.live("executes a built-in all-shows view with per-user isolation", () =>
		Effect.gen(function* () {
			const userA = yield* createAuthenticatedClient();
			const userB = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(userA.client, "show");

			const entity = yield* seedMediaEntity({
				userId: null,
				entitySchemaSlug: schema.id,
				sandboxScriptId: getFirstProviderScriptId(schema),
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

			yield* insertLibraryMembership(userA.client, {
				mediaEntityId: entity.id,
			});

			const userAView = yield* getSavedView(userA.client, "all-shows");
			const userBView = yield* getSavedView(userB.client, "all-shows");
			const userAResult = yield* executeQueryEngine(userA.client, userAView.queryDocument);
			const userBResult = yield* executeQueryEngine(userB.client, userBView.queryDocument);

			expect(
				userAResult.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value),
			).toContain(entity.name);
			expect(userBResult.data.items).toHaveLength(0);
		}),
	);

	it.live("keeps built-in media saved views executable after refetching their definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "show");

			const entity = yield* seedMediaEntity({
				userId: null,
				entitySchemaSlug: schema.id,
				sandboxScriptId: getFirstProviderScriptId(schema),
				name: `Refetched All Shows ${crypto.randomUUID()}`,
				externalId: `refetched-all-shows-${crypto.randomUUID()}`,
				properties: {
					genres: [],
					images: [],
					isNsfw: null,
					sourceUrl: null,
					totalSeasons: 0,
					totalEpisodes: 0,
					description: null,
					publishYear: 2020,
					providerRating: 88.5,
					unlinkedCreators: [],
					productionStatus: "Returning Series",
				},
			});

			yield* insertLibraryMembership(client, { mediaEntityId: entity.id });

			yield* getSavedView(client, "all-shows");
			const refetchedView = yield* getSavedView(client, "all-shows");
			const result = yield* executeQueryEngine(client, refetchedView.queryDocument);

			expect(
				result.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value),
			).toContain(entity.name);
		}),
	);
});
