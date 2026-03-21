import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createSavedViewWithQueryDocument,
	aggregateDocument,
	executeRyotQL,
	findBuiltinSchemaBySlug,
	getSavedView,
	insertLibraryMembership,
	requireRyotQLTextField,
	seedMediaEntity,
	timeSeriesDocument,
} from "~/fixtures";
import type { RyotQLResponse } from "~/fixtures/ryotql";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireSavedViewRows = (response: RyotQLResponse) => {
	const result = response.data.savedView;
	if (result?.type !== "rows") {
		throw new Error("Expected the savedView named query to return rows");
	}
	return result;
};

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

			yield* insertLibraryMembership(userA.client, {
				mediaEntityId: entity.id,
			});

			const userAView = yield* getSavedView(userA.client, "all-shows");
			const userBView = yield* getSavedView(userB.client, "all-shows");
			const userAResult = requireSavedViewRows(
				yield* executeRyotQL(userA.client, userAView.queryDocument),
			);
			const userBResult = requireSavedViewRows(
				yield* executeRyotQL(userB.client, userBView.queryDocument),
			);

			expect(userAResult.items.map((item) => requireRyotQLTextField(item, "name"))).toContain(
				entity.name,
			);
			expect(userBResult.items).toHaveLength(0);
		}),
	);

	it.live("keeps built-in media saved views executable after refetching their definitions", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(client, "show");
			const providerId = schema.providers[0]?.providerId;
			assertPresent(providerId, "Expected a provider for the show schema");

			const entity = yield* seedMediaEntity({
				userId: null,
				entitySchemaSlug: schema.id,
				providerId,
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
			const result = requireSavedViewRows(
				yield* executeRyotQL(client, refetchedView.queryDocument),
			);

			expect(result.items.map((item) => requireRyotQLTextField(item, "name"))).toContain(
				entity.name,
			);
		}),
	);

	it.live("executes aggregate and time-series saved-view named results", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const aggregateView = yield* createSavedViewWithQueryDocument(client, aggregateDocument, {
				name: `Aggregate Execution View ${crypto.randomUUID()}`,
			});
			const timeSeriesView = yield* createSavedViewWithQueryDocument(client, timeSeriesDocument, {
				name: `Time Series Execution View ${crypto.randomUUID()}`,
			});

			const aggregateResult = (yield* executeRyotQL(client, aggregateView.queryDocument)).data
				.savedView;
			if (aggregateResult?.type !== "aggregate") {
				throw new Error("Expected an aggregate saved-view result");
			}
			expect(aggregateResult.items[0]?.total).toMatchObject({ kind: "number" });

			const timeSeriesResult = (yield* executeRyotQL(client, timeSeriesView.queryDocument)).data
				.savedView;
			if (timeSeriesResult?.type !== "timeSeries") {
				throw new Error("Expected a time-series saved-view result");
			}
			expect(timeSeriesResult.buckets.length).toBeGreaterThan(0);
			expect(timeSeriesResult.buckets.every(({ value }) => typeof value === "number")).toBe(true);
		}),
	);
});
