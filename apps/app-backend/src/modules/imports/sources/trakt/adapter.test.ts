import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-utils/source-http";

import { adaptTraktData } from "./adapter";

const singlePage: StubHttpResponse = { headers: { "x-pagination-page-count": "1" } };

// Trakt fetches every collection through a HEAD page-count probe followed by a
// paged GET. HEAD requests get the page-count header; GETs default to an empty
// page so each test only fills the endpoints it cares about.
const traktRoutes =
	(getBodies: Record<string, unknown>) =>
	(request: { path: string; method: string }): StubHttpResponse =>
		request.method === "HEAD" ? singlePage : { body: getBodies[request.path] ?? [] };

describe("adaptTraktData", () => {
	it.effect("maps watched movies and episodes from paged history", () =>
		Effect.gen(function* () {
			const result = yield* adaptTraktData("alice", "client-id").pipe(
				Effect.provide(
					stubHttpClientLayer(
						traktRoutes({
							"/users/alice/history": [
								{
									id: 1,
									type: "movie",
									watched_at: "2026-01-01T00:00:00.000Z",
									movie: { ids: { tmdb: 603 }, title: "The Matrix" },
								},
								{
									id: 2,
									type: "episode",
									watched_at: "2026-01-02T00:00:00.000Z",
									episode: { ids: {}, season: 1, number: 2 },
									show: { ids: { tmdb: 1399 }, title: "Game of Thrones" },
								},
							],
						}),
					),
				),
			);

			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(2);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { kind: "resolved", externalId: "603", scriptSlug: "movie.tmdb" },
				events: [{ eventSchemaSlug: "complete" }],
			});
			expect(result.entityGroups[1]).toMatchObject({
				entityRef: { kind: "resolved", externalId: "1399", scriptSlug: "show.tmdb" },
				events: [
					{
						eventSchemaSlug: "progress",
						episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 2 },
					},
				],
			});
		}),
	);

	it.effect("records a failure when a watched movie has no TMDB or IMDb id", () =>
		Effect.gen(function* () {
			const result = yield* adaptTraktData("alice", "client-id").pipe(
				Effect.provide(
					stubHttpClientLayer(
						traktRoutes({
							"/users/alice/history": [
								{
									id: 1,
									type: "movie",
									watched_at: "2026-01-01T00:00:00.000Z",
									movie: { ids: { trakt: 77 }, title: "Mystery" },
								},
							],
						}),
					),
				),
			);

			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				sourceLabel: "Mystery",
				sourceIdentifier: "77",
				message: "Movie does not have a TMDB or IMDb id",
			});
		}),
	);
});
