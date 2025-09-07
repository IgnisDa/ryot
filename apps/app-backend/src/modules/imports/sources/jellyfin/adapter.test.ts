import { describe, expect, it } from "bun:test";

import { resolveMockResponse } from "../shared/test-utils";
import { adaptJellyfinData } from "./adapter";

const createDeps = () => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>(input: { path: string }) => {
		if (input.path === "Users/AuthenticateByName") {
			return resolveMockResponse<T>({ AccessToken: "token_1", User: { Id: "user_1" } });
		}

		if (input.path === "Users/user_1/Items") {
			return resolveMockResponse<T>({
				Items: [
					{
						Id: "movie_1",
						Type: "Movie",
						Name: "Movie One",
						ProviderIds: { Tmdb: "10" },
						UserData: { IsFavorite: true, LastPlayedDate: "2026-01-01T00:00:00.000Z" },
					},
					{
						IndexNumber: 3,
						Id: "episode_1",
						Type: "Episode",
						Name: "Episode One",
						ParentIndexNumber: 2,
						SeriesId: "series_1",
						SeriesName: "Show One",
						UserData: { IsFavorite: true, LastPlayedDate: "2026-01-02T00:00:00.000Z" },
					},
					{
						Id: "movie_2",
						Type: "Movie",
						Name: "Movie Two",
						UserData: { LastPlayedDate: "2026-01-03T00:00:00.000Z" },
					},
				],
			});
		}

		if (input.path === "Items/series_1") {
			return resolveMockResponse<T>({
				Id: "series_1",
				Name: "Show One",
				ProviderIds: { Tvdb: "tv_77" },
			});
		}

		throw new Error(`Unhandled path ${input.path}`);
	},
});

describe("adaptJellyfinData", () => {
	it("maps completed movies, watched episodes, and favorites", async () => {
		const result = await adaptJellyfinData(
			{ apiUrl: "https://jellyfin.local", password: "pw_1", username: "alice" },
			createDeps(),
		);

		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			collectionMemberships: [{ collectionName: "Favorites" }],
			entityRef: {
				externalId: "10",
				kind: "resolved",
				scriptSlug: "movie.tmdb",
				sourceLabel: "Movie One",
				entitySchemaSlug: "movie",
			},
		});
		expect(result.entityGroups[0]?.events[0]).toEqual({
			eventSchemaSlug: "complete",
			occurredAt: "2026-01-01T00:00:00.000Z",
			properties: { completionMode: "custom_timestamps", completedOn: "2026-01-01T00:00:00.000Z" },
		});

		expect(result.entityGroups[1]).toMatchObject({
			collectionMemberships: [{ collectionName: "Favorites" }],
			entityRef: {
				kind: "resolved",
				externalId: "tv_77",
				scriptSlug: "show.tvdb",
				sourceLabel: "Show One",
				entitySchemaSlug: "show",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-02T00:00:00.000Z",
					properties: { progressPercent: 100, showEpisode: 3, showSeason: 2 },
				},
			],
		});

		expect(result.failures).toEqual([
			{
				itemIndex: 2,
				sourceLabel: "Movie Two",
				sourceIdentifier: "movie_2",
				stage: "input_transformation",
				message: "Jellyfin movie has no TMDB, TVDB, or IMDb identifier",
			},
		]);
	});
});
