import { describe, expect, it } from "bun:test";

import { expectDefined } from "../shared/test-utils";
import { adaptTraktData } from "./adapter";

const getGroup = (result: Awaited<ReturnType<typeof adaptTraktData>>, sourceLabel: string) => {
	const group = result.entityGroups.find(
		(candidate) => candidate.entityRef.sourceLabel === sourceLabel,
	);
	return expectDefined(group, `Expected entity group for ${sourceLabel}`);
};

const createFetch = () => (url: string | URL, init?: RequestInit) => {
	const requestUrl = new URL(String(url));
	const path = requestUrl.pathname;

	if (init?.method === "HEAD") {
		return Promise.resolve(
			new Response(null, { headers: { "x-pagination-page-count": "1" }, status: 200 }),
		);
	}

	if (path === "/users/alice/history") {
		return Promise.resolve(
			Response.json([
				{
					type: "movie",
					watched_at: "2026-01-04T00:00:00.000Z",
					movie: { ids: { tmdb: 10, trakt: 1 }, title: "Movie One" },
				},
				{
					type: "movie",
					watched_at: "2026-01-01T00:00:00.000Z",
					movie: { ids: { tmdb: 10, trakt: 1 }, title: "Movie One" },
				},
				{
					type: "episode",
					watched_at: "2026-01-02T00:00:00.000Z",
					show: { ids: { imdb: "tt1234567", trakt: 2 }, title: "Show One" },
					episode: { ids: { trakt: 99 }, number: 4, season: 2, title: "Episode Four" },
				},
			]),
		);
	}

	if (path === "/users/alice/ratings/movies") {
		return Promise.resolve(
			Response.json([
				{
					rating: 8,
					type: "movie",
					rated_at: "2026-01-03T00:00:00.000Z",
					movie: { ids: { tmdb: 10, trakt: 1 }, title: "Movie One" },
				},
			]),
		);
	}

	if (path === "/users/alice/ratings/shows") {
		return Promise.resolve(Response.json([]));
	}

	if (path === "/users/alice/watchlist") {
		return Promise.resolve(
			Response.json([
				{
					type: "movie",
					listed_at: "2026-01-04T00:00:00.000Z",
					movie: { ids: { tmdb: 11, trakt: 3 }, title: "Movie Two" },
				},
			]),
		);
	}

	if (path === "/users/alice/lists") {
		return Promise.resolve(Response.json([{ ids: { trakt: 77 }, name: "Favorites" }]));
	}

	if (path === "/users/alice/lists/77/items") {
		return Promise.resolve(
			Response.json([{ show: { ids: { tmdb: 44, trakt: 4 }, title: "Show Two" }, type: "show" }]),
		);
	}

	if (path === "/users/alice/collection/movies") {
		return Promise.resolve(
			Response.json([{ movie: { ids: { tmdb: 12, trakt: 5 }, title: "Movie Three" } }]),
		);
	}

	if (path === "/users/alice/collection/shows") {
		return Promise.resolve(Response.json([]));
	}

	throw new Error(`Unhandled request ${path}`);
};

describe("adaptTraktData", () => {
	it("maps history, ratings, watchlist, collections, and custom lists", async () => {
		const result = await adaptTraktData("alice", "client_1", {
			fetch: createFetch(),
			now: () => "2026-01-05T00:00:00.000Z",
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(5);

		expect(getGroup(result, "Movie One")).toMatchObject({
			entityRef: {
				externalId: "10",
				kind: "resolved",
				scriptSlug: "movie.tmdb",
				sourceLabel: "Movie One",
				entitySchemaSlug: "movie",
			},
			events: [
				{
					eventSchemaSlug: "complete",
					occurredAt: "2026-01-01T00:00:00.000Z",
					properties: {
						completionMode: "custom_timestamps",
						completedOn: "2026-01-01T00:00:00.000Z",
					},
				},
				{
					eventSchemaSlug: "review",
					properties: { rating: 80 },
					occurredAt: "2026-01-03T00:00:00.000Z",
				},
				{
					eventSchemaSlug: "complete",
					occurredAt: "2026-01-04T00:00:00.000Z",
					properties: {
						completionMode: "custom_timestamps",
						completedOn: "2026-01-04T00:00:00.000Z",
					},
				},
			],
		});

		expect(getGroup(result, "Show One")).toMatchObject({
			entityRef: {
				kind: "unresolved",
				identifierType: "imdb",
				sourceLabel: "Show One",
				entitySchemaSlug: "show",
				identifierValue: "tt1234567",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { progressPercent: 100, showEpisode: 4, showSeason: 2 },
				},
			],
		});

		expect(getGroup(result, "Movie Two")).toMatchObject({
			events: [{ eventSchemaSlug: "backlog", properties: {} }],
			entityRef: { externalId: "11", scriptSlug: "movie.tmdb" },
		});

		expect(getGroup(result, "Movie Three")).toMatchObject({
			collectionMemberships: [{ collectionName: "Owned" }],
			entityRef: { externalId: "12", scriptSlug: "movie.tmdb" },
		});

		expect(getGroup(result, "Show Two")).toMatchObject({
			collectionMemberships: [{ collectionName: "Favorites" }],
			entityRef: { externalId: "44", scriptSlug: "show.tmdb" },
		});
	});
});
