import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { stubHttpClientLayer, type StubHttpResponse } from "#lib/test-utils/source-http";

import { syncPlexYankOwnedItems } from "./adapter";

const input = { apiKey: "token", apiUrl: "http://plex.test:32400" };

const directories = (entries: Array<{ key: string; type: string; title: string }>) => ({
	MediaContainer: { Directory: entries },
});

const metadata = (items: ReadonlyArray<Record<string, unknown>>) => ({
	MediaContainer: { Metadata: items },
});

describe("syncPlexYankOwnedItems", () => {
	it.effect("returns owned movies and shows regardless of watch state", () =>
		Effect.gen(function* () {
			// Neither item carries lastViewedAt: ownership is independent of play
			// history, unlike the import path which requires a watched timestamp.
			const routes: Record<string, StubHttpResponse> = {
				"/library/sections": {
					body: directories([
						{ key: "1", type: "movie", title: "Movies" },
						{ key: "2", type: "show", title: "Shows" },
					]),
				},
				"/library/sections/1/all": {
					body: metadata([
						{ type: "movie", key: "/m/1", title: "Arrival", Guid: [{ id: "tmdb://329865" }] },
					]),
				},
				"/library/sections/2/all": {
					body: metadata([
						{ type: "show", key: "/s/1", title: "Severance", Guid: [{ id: "tmdb://95396" }] },
					]),
				},
			};

			const result = yield* syncPlexYankOwnedItems(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result).toEqual([
				{
					provider: "plex_yank",
					entityRef: {
						kind: "resolved",
						externalId: "329865",
						sourceLabel: "Arrival",
						scriptSlug: "movie.tmdb",
						entitySchemaSlug: "movie",
					},
				},
				{
					provider: "plex_yank",
					entityRef: {
						kind: "resolved",
						externalId: "95396",
						sourceLabel: "Severance",
						scriptSlug: "show.tmdb",
						entitySchemaSlug: "show",
					},
				},
			]);
		}),
	);

	it.effect("omits items without a provider id", () =>
		Effect.gen(function* () {
			const routes: Record<string, StubHttpResponse> = {
				"/library/sections": { body: directories([{ key: "1", type: "movie", title: "Movies" }]) },
				"/library/sections/1/all": {
					body: metadata([
						{ type: "movie", key: "/m/1", title: "With Id", Guid: [{ id: "tmdb://1" }] },
						{ type: "movie", key: "/m/2", title: "No Id" },
					]),
				},
			};

			const result = yield* syncPlexYankOwnedItems(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({ entityRef: { externalId: "1" } });
		}),
	);

	it.effect("skips a section whose item fetch fails and keeps the rest", () =>
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
						{ type: "movie", key: "/m/1", title: "Arrival", Guid: [{ id: "tmdb://329865" }] },
					]),
				},
				"/library/sections/2/all": { status: 500 },
			};

			const result = yield* syncPlexYankOwnedItems(input).pipe(
				Effect.provide(stubHttpClientLayer((request) => routes[request.path] ?? { body: {} })),
			);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				provider: "plex_yank",
				entityRef: { externalId: "329865", entitySchemaSlug: "movie" },
			});
		}),
	);
});
