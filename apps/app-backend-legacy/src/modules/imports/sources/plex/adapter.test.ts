import { describe, expect, it } from "bun:test";

import { ImportSourceRequestError } from "../../runtime/source-api";
import { resolveMockResponse } from "../shared/test-utils";
import { adaptPlexData } from "./adapter";

const createDeps = () => ({
	mapWithConcurrency: async <TItem, TResult>(
		items: TItem[],
		_concurrency: number,
		mapper: (item: TItem, index: number) => Promise<TResult>,
	) => Promise.all(items.map((item, index) => mapper(item, index))),
	requestJson: <T>(input: { path: string }) => {
		if (input.path === "library/sections") {
			return resolveMockResponse<T>({
				MediaContainer: {
					Directory: [
						{ key: "1", title: "Movies", type: "movie" },
						{ key: "2", title: "Shows", type: "show" },
					],
				},
			});
		}

		if (input.path === "library/sections/1/all") {
			return resolveMockResponse<T>({
				MediaContainer: {
					Metadata: [
						{
							type: "movie",
							key: "movie_1",
							title: "Movie One",
							lastViewedAt: 1716000000,
							Guid: [{ id: "tmdb://101" }],
						},
						{
							Guid: [],
							type: "movie",
							key: "movie_2",
							title: "Movie Two",
							lastViewedAt: 1716001000,
						},
					],
				},
			});
		}

		if (input.path === "library/sections/2/all") {
			return resolveMockResponse<T>({
				MediaContainer: {
					Metadata: [
						{
							type: "show",
							key: "show_1",
							title: "Show One",
							lastViewedAt: 1716002000,
							ratingKey: "show_rating_1",
							Guid: [{ id: "tvdb://202" }],
						},
						{
							type: "show",
							key: "show_2",
							title: "Show Two",
							lastViewedAt: 1716003000,
							ratingKey: "show_rating_2",
							Guid: [{ id: "imdb://tt0099999" }],
						},
					],
				},
			});
		}

		if (input.path === "library/metadata/show_rating_1/allLeaves") {
			return resolveMockResponse<T>({
				MediaContainer: {
					Metadata: [
						{
							index: 1,
							key: "e1",
							title: "Ep 1",
							parentIndex: 1,
							type: "episode",
							lastViewedAt: 1716002100,
						},
						{
							index: 2,
							key: "e2",
							title: "Ep 2",
							parentIndex: 1,
							type: "episode",
							lastViewedAt: 1716002200,
						},
					],
				},
			});
		}

		if (input.path === "library/metadata/show_rating_2/allLeaves") {
			throw new ImportSourceRequestError({
				context: { host: "plex.local", status: 500 },
				message: "Plex request to plex.local failed with status 500",
			});
		}

		throw new Error(`Unhandled path ${input.path}`);
	},
});

describe("adaptPlexData", () => {
	it("maps watched movies and episodes and records item-level failures", async () => {
		const result = await adaptPlexData(
			{ apiKey: "secret", apiUrl: "https://plex.local" },
			createDeps(),
		);

		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]?.entityRef).toEqual({
			kind: "resolved",
			externalId: "101",
			scriptSlug: "movie.tmdb",
			sourceLabel: "Movie One",
			entitySchemaSlug: "movie",
		});
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: expect.any(String),
				properties: { completionMode: "custom_timestamps", completedOn: expect.any(String) },
			},
		]);

		expect(result.entityGroups[1]?.entityRef).toEqual({
			kind: "resolved",
			externalId: "202",
			scriptSlug: "show.tvdb",
			sourceLabel: "Show One",
			entitySchemaSlug: "show",
		});
		expect(result.entityGroups[1]?.events).toEqual([
			{
				eventSchemaSlug: "progress",
				occurredAt: expect.any(String),
				properties: { progressPercent: 100, showEpisode: 1, showSeason: 1 },
			},
			{
				eventSchemaSlug: "progress",
				occurredAt: expect.any(String),
				properties: { progressPercent: 100, showEpisode: 2, showSeason: 1 },
			},
		]);

		expect(result.failures).toEqual([
			{
				itemIndex: 1,
				sourceLabel: "Movie Two",
				sourceIdentifier: "movie_2",
				stage: "input_transformation",
				message: "Plex item has no TMDB, TVDB, or IMDb identifier",
			},
			{
				itemIndex: 3,
				stage: "source_fetch",
				sourceLabel: "Show Two",
				sourceIdentifier: "show_2",
				context: { host: "plex.local", status: 500 },
				message: "Failed to fetch watched episodes from Plex",
			},
		]);
	});
});
