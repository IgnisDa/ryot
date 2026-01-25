import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-support/source-http";

import { adaptPlexData } from "./adapter";

const apiUrl = "http://plex.test:32400";

const directories = (entries: Array<{ key: string; type: string; title: string }>) => ({
	MediaContainer: { Directory: entries },
});

const metadata = (items: ReadonlyArray<Record<string, unknown>>) => ({
	MediaContainer: { Metadata: items },
});

describe("adaptPlexData", () => {
	it.effect("maps watched movies and per-episode show coverage by guid", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/library/sections": {
					body: directories([
						{ key: "1", type: "movie", title: "Movies" },
						{ key: "2", type: "show", title: "Shows" },
					]),
				},
				"/library/sections/1/all": {
					body: metadata([
						{
							key: "/m/1",
							type: "movie",
							title: "Arrival",
							lastViewedAt: 1700000000,
							Guid: [{ id: "tmdb://329865" }],
						},
					]),
				},
				"/library/sections/2/all": {
					body: metadata([
						{
							type: "show",
							key: "/s/1",
							ratingKey: "555",
							title: "Severance",
							lastViewedAt: 1700000000,
							Guid: [{ id: "tmdb://95396" }],
						},
					]),
				},
				"/library/metadata/555/allLeaves": {
					body: metadata([
						{
							index: 3,
							key: "/e/1",
							title: "Ep1",
							parentIndex: 1,
							type: "episode",
							lastViewedAt: 1700000100,
						},
					]),
				},
			};

			const result = yield* adaptPlexData({ apiKey: "token", apiUrl }).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result.failures).toEqual([]);
			expect(result.entityGroups).toHaveLength(2);
			expect(result.entityGroups[0]).toMatchObject({
				events: [{ eventSchemaSlug: "complete" }],
				entityRef: {
					kind: "resolved",
					externalId: "329865",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				},
			});
			expect(result.entityGroups[1]).toMatchObject({
				entityRef: {
					kind: "resolved",
					externalId: "95396",
					scriptSlug: "show.tmdb",
					entitySchemaSlug: "show",
				},
				events: [
					{
						eventSchemaSlug: "progress",
						properties: { progressPercent: 100 },
						episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 3 },
					},
				],
			});
		}),
	);

	it.effect("records a failure for a watched item without a provider id", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/library/sections": { body: directories([{ key: "1", type: "movie", title: "Movies" }]) },
				"/library/sections/1/all": {
					body: metadata([
						{ type: "movie", key: "/m/9", title: "No Ids", lastViewedAt: 1700000000 },
					]),
				},
			};

			const result = yield* adaptPlexData({ apiKey: "token", apiUrl }).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({
				itemIndex: 0,
				sourceLabel: "No Ids",
				stage: "input_transformation",
				message: "Plex item has no TMDB, TVDB, or IMDb identifier",
			});
		}),
	);
});
