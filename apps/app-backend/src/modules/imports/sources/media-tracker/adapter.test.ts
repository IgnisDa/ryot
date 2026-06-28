import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-utils/source-http";

import { adaptMediaTrackerData } from "./adapter";

const input = { apiKey: "key", apiUrl: "http://mt.test" };

describe("adaptMediaTrackerData", () => {
	it.effect("maps seen movies and games to resolved provider refs", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/api/lists": { body: [] },
				"/api/user": { body: { id: 1 } },
				"/api/items": {
					body: [
						{ id: 10, mediaType: "movie" },
						{ id: 11, mediaType: "video_game" },
					],
				},
				"/api/details/10": {
					body: {
						id: 10,
						tmdbId: 27205,
						title: "Inception",
						seenHistory: [{ id: 1, date: "2026-01-05T00:00:00.000Z" }],
					},
				},
				"/api/details/11": {
					body: {
						id: 11,
						igdbId: 7346,
						title: "Hades",
						seenHistory: [{ id: 2, date: "2026-02-01T00:00:00.000Z" }],
					},
				},
			};

			const result = yield* adaptMediaTrackerData(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: [] })),
			);

			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(2);
			expect(result.entityGroups[0]).toMatchObject({
				entityRef: { kind: "resolved", externalId: "27205", scriptSlug: "movie.tmdb" },
				events: [{ eventSchemaSlug: "complete" }],
			});
			expect(result.entityGroups[1]).toMatchObject({
				events: [{ eventSchemaSlug: "complete" }],
				entityRef: {
					kind: "resolved",
					externalId: "7346",
					scriptSlug: "video-game.igdb",
					entitySchemaSlug: "video-game",
				},
			});
		}),
	);

	it.effect("records a failure for an item missing a supported provider id", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/api/lists": { body: [] },
				"/api/user": { body: { id: 1 } },
				"/api/items": { body: [{ id: 20, mediaType: "movie" }] },
				"/api/details/20": { body: { id: 20, title: "No Tmdb" } },
			};

			const result = yield* adaptMediaTrackerData(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: [] })),
			);

			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				itemIndex: 0,
				sourceLabel: "No Tmdb",
				sourceIdentifier: "20",
				stage: "input_transformation",
				message: "MediaTracker movie item is missing a supported provider identifier",
			});
		}),
	);
});
