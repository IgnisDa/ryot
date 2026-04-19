import { describe, expect, it } from "bun:test";

import { resolveMockResponse } from "~/modules/imports/sources/shared/test-utils";

import { fetchPlexYankProgress, syncPlexYankOwnedItems } from "./plex-yank";

const MOCK_INPUT = { token: "plex-token", baseUrl: "https://plex.local" };

const createDeps = (sections: unknown[], itemsBySection: Record<string, unknown[]>) => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>(input: { path: string }) => {
		if (input.path === "library/sections") {
			return resolveMockResponse<T>({ MediaContainer: { Directory: sections } });
		}
		const match = input.path.match(/^library\/sections\/(\w+)\/all$/);
		if (match?.[1]) {
			return resolveMockResponse<T>({
				MediaContainer: { Metadata: itemsBySection[match[1]] ?? [] },
			});
		}
		throw new Error(`Unhandled: ${input.path}`);
	},
});

describe("fetchPlexYankProgress", () => {
	it("always returns empty result (PlexYank is owned-only)", () => {
		const result = fetchPlexYankProgress();
		expect(result.entityGroups).toHaveLength(0);
		expect(result.failures).toHaveLength(0);
	});
});

describe("syncPlexYankOwnedItems", () => {
	it("resolves movies and shows by TMDB guid", async () => {
		const deps = createDeps(
			[
				{ key: "1", type: "movie", title: "Movies" },
				{ key: "2", type: "show", title: "Shows" },
			],
			{
				"1": [{ title: "Movie A", type: "movie", Guid: [{ id: "tmdb://101" }] }],
				"2": [{ title: "Show B", type: "show", Guid: [{ id: "tmdb://202" }] }],
			},
		);

		const result = await syncPlexYankOwnedItems(MOCK_INPUT, deps);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			provider: "plex_yank",
			entityRef: {
				kind: "resolved",
				externalId: "101",
				scriptSlug: "movie.tmdb",
				entitySchemaSlug: "movie",
			},
		});
		expect(result[1]).toMatchObject({
			provider: "plex_yank",
			entityRef: {
				kind: "resolved",
				externalId: "202",
				scriptSlug: "show.tmdb",
				entitySchemaSlug: "show",
			},
		});
	});

	it("falls back to unresolved ref for IMDB guid", async () => {
		const deps = createDeps([{ key: "1", type: "movie", title: "Movies" }], {
			"1": [{ title: "Old Film", type: "movie", Guid: [{ id: "imdb://tt1234567" }] }],
		});

		const result = await syncPlexYankOwnedItems(MOCK_INPUT, deps);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			entityRef: { kind: "unresolved", identifierType: "imdb_id", identifierValue: "tt1234567" },
		});
	});

	it("skips items with no resolvable guid", async () => {
		const deps = createDeps([{ key: "1", type: "movie", title: "Movies" }], {
			"1": [{ title: "Unknown", type: "movie", Guid: [{ id: "local://123" }] }],
		});

		const result = await syncPlexYankOwnedItems(MOCK_INPUT, deps);

		expect(result).toHaveLength(0);
	});

	it("returns empty result when library is empty", async () => {
		const deps = createDeps([{ key: "1", type: "movie" }], { "1": [] });

		const result = await syncPlexYankOwnedItems(MOCK_INPUT, deps);

		expect(result).toHaveLength(0);
	});
});
