import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-utils/source-http";

import { adaptJellyfinData } from "./adapter";

const apiUrl = "http://jellyfin.test";
const input = { apiUrl, username: "alice", password: "secret" };

const auth = { AccessToken: "tok", User: { Id: "u1" } };

describe("adaptJellyfinData", () => {
	it.effect("authenticates, then maps played movies and episodes via series details", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/Users/AuthenticateByName": { body: auth },
				"/Users/u1/Items": {
					body: {
						Items: [
							{
								Id: "m1",
								Type: "Movie",
								Name: "Dune",
								ProviderIds: { Tmdb: "693134" },
								UserData: { IsFavorite: true, LastPlayedDate: "2026-01-02T10:00:00.000Z" },
							},
							{
								Id: "e1",
								SeriesId: "s1",
								IndexNumber: 4,
								Type: "Episode",
								Name: "Episode",
								ParentIndexNumber: 2,
								SeriesName: "Severance",
								UserData: { LastPlayedDate: "2026-01-03T10:00:00.000Z" },
							},
						],
					},
				},
				"/Items/s1": { body: { Id: "s1", Name: "Severance", ProviderIds: { Tmdb: "95396" } } },
			};

			const result = yield* adaptJellyfinData(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(2);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ eventSchemaSlug: "complete" }],
				collectionMemberships: [{ collectionName: "Favorites" }],
				entityRef: { kind: "resolved", externalId: "693134", entitySchemaSlug: "movie" },
			});
			expect(result.entityGroups[1]).toMatchObject({
				entityRef: { kind: "resolved", externalId: "95396", entitySchemaSlug: "show" },
				events: [
					{
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						episodeLocator: { type: "show", seasonNumber: 2, episodeNumber: 4 },
					},
				],
			});
		}),
	);

	it.effect("records a failure for an item without a played timestamp", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/Users/AuthenticateByName": { body: auth },
				"/Users/u1/Items": {
					body: {
						Items: [{ Id: "m9", Type: "Movie", Name: "Unwatched", ProviderIds: { Tmdb: "1" } }],
					},
				},
			};

			const result = yield* adaptJellyfinData(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				itemIndex: 0,
				sourceIdentifier: "m9",
				sourceLabel: "Unwatched",
				stage: "input_transformation",
				message: "Jellyfin item has no played timestamp",
			});
		}),
	);
});
