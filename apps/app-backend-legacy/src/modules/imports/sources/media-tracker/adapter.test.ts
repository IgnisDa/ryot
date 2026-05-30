import { describe, expect, it } from "bun:test";

import { expectDefined, resolveMockResponse } from "../shared/test-utils";
import { adaptMediaTrackerData } from "./adapter";

const getGroup = (
	result: Awaited<ReturnType<typeof adaptMediaTrackerData>>,
	sourceLabel: string,
) => {
	const group = result.entityGroups.find(
		(candidate) => candidate.entityRef.sourceLabel === sourceLabel,
	);
	return expectDefined(group, `Expected entity group for ${sourceLabel}`);
};

const createDeps = () => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>(input: { path: string; query?: Record<string, unknown> }) => {
		if (input.path === "user") {
			return resolveMockResponse<T>({ id: 7 });
		}

		if (input.path === "lists") {
			return resolveMockResponse<T>([
				{ id: 1, name: "watchlist" },
				{ id: 2, name: "Favorites" },
			]);
		}

		if (input.path === "list/items" && input.query?.listId === 1) {
			return resolveMockResponse<T>([{ mediaItem: { id: 10, mediaType: "movie" } }]);
		}

		if (input.path === "list/items" && input.query?.listId === 2) {
			return resolveMockResponse<T>([
				{ mediaItem: { id: 20, mediaType: "book" } },
				{ mediaItem: { id: 30, mediaType: "book" } },
			]);
		}

		if (input.path === "items") {
			return resolveMockResponse<T>([
				{ id: 10, mediaType: "movie" },
				{ id: 40, mediaType: "tv" },
				{ id: 50, mediaType: "video_game" },
			]);
		}

		if (input.path === "details/10") {
			return resolveMockResponse<T>({
				id: 10,
				seasons: [],
				tmdbId: 500,
				title: "Movie One",
				seenHistory: [{ date: "2026-01-02T00:00:00.000Z", id: 1 }],
				userRating: { id: 1, rating: 4.5, review: "Great", date: "2026-01-03T00:00:00.000Z" },
			});
		}

		if (input.path === "details/20") {
			return resolveMockResponse<T>({
				id: 20,
				seasons: [],
				seenHistory: [],
				openlibraryId: "/works/OL123W",
			});
		}

		if (input.path === "details/30") {
			return resolveMockResponse<T>({ goodreadsId: 9, id: 30, seasons: [], seenHistory: [] });
		}

		if (input.path === "details/40") {
			return resolveMockResponse<T>({
				id: 40,
				tmdbId: 700,
				title: "Show One",
				seasons: [{ episodes: [{ episodeNumber: 5, id: 900, seasonNumber: 2 }] }],
				seenHistory: [{ date: "2026-02-01T00:00:00.000Z", episodeId: 900, id: 1 }],
			});
		}

		if (input.path === "details/50") {
			return resolveMockResponse<T>({
				id: 50,
				igdbId: 900,
				seasons: [],
				title: "Game One",
				seenHistory: [{ date: 1716000000000, id: 1 }],
			});
		}

		throw new Error(`Unhandled path ${input.path}`);
	},
});

describe("adaptMediaTrackerData", () => {
	it("maps lifecycle aliases, collections, reviews, and seen history", async () => {
		const result = await adaptMediaTrackerData(
			{ apiKey: "secret", apiUrl: "https://mediatracker.local" },
			createDeps(),
		);

		expect(result.entityGroups).toHaveLength(4);
		expect(getGroup(result, "Movie One")).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "500",
				scriptSlug: "movie.tmdb",
				sourceLabel: "Movie One",
				entitySchemaSlug: "movie",
			},
		});
		expect(getGroup(result, "Movie One").events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2026-01-02T00:00:00.000Z",
				properties: {
					completionMode: "custom_timestamps",
					completedOn: "2026-01-02T00:00:00.000Z",
				},
			},
			{
				properties: {},
				eventSchemaSlug: "backlog",
				occurredAt: "2026-01-03T00:00:00.000Z",
			},
			{
				eventSchemaSlug: "review",
				occurredAt: "2026-01-03T00:00:00.000Z",
				properties: { rating: 90, text: "Great" },
			},
		]);

		expect(getGroup(result, "Book 20")).toMatchObject({
			collectionMemberships: [{ collectionName: "Favorites" }],
			entityRef: {
				kind: "resolved",
				externalId: "OL123W",
				entitySchemaSlug: "book",
				scriptSlug: "book.openlibrary",
			},
		});

		expect(getGroup(result, "Show One")).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "700",
				scriptSlug: "show.tmdb",
				sourceLabel: "Show One",
				entitySchemaSlug: "show",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { progressPercent: 100, showEpisode: 5, showSeason: 2 },
				},
			],
		});

		expect(getGroup(result, "Game One")).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "900",
				sourceLabel: "Game One",
				scriptSlug: "video-game.igdb",
				entitySchemaSlug: "video-game",
			},
			events: [
				{
					eventSchemaSlug: "complete",
					properties: { completedOn: expect.any(String), completionMode: "custom_timestamps" },
				},
			],
		});

		expect(result.failures).toEqual([
			{
				itemIndex: 2,
				sourceLabel: "Book 30",
				sourceIdentifier: "30",
				stage: "input_transformation",
				message: "MediaTracker book uses an unsupported Goodreads identifier",
			},
		]);
	});
});
