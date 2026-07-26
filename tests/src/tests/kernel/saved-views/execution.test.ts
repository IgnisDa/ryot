import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQL,
	findBuiltinSchemaBySlug,
	getSavedView,
	insertLibraryMembership,
	requireRyotQLTextField,
	requireRows,
	seedMediaEntity,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("saved views execution", () => {
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
				(yield* executeRyotQL(userA.client, userAView.queryDocument)).data.savedView,
				"savedView",
			);
			const userBResult = requireRows(
				(yield* executeRyotQL(userB.client, userBView.queryDocument)).data.savedView,
				"savedView",
			);

			expect(userAResult.items.map((item) => requireRyotQLTextField(item, "gridTitle"))).toContain(
				entity.name,
			);
			expect(userBResult.items).toHaveLength(0);
		}),
	);
});
