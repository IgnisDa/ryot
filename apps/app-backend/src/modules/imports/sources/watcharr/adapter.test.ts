import { describe, expect, it } from "bun:test";

import { adaptWatcharrExport } from "./adapter";

describe("adaptWatcharrExport", () => {
	it("maps movie lifecycle, review, collection, and show episode coverage", () => {
		const exportJson = JSON.stringify([
			{
				rating: 7,
				pinned: true,
				activity: [],
				thoughts: "Soon",
				status: "PLANNED",
				watchedEpisodes: [],
				content: { tmdbId: 10, title: "Arrival", type: "movie" },
			},
			{
				rating: 0,
				thoughts: "",
				pinned: false,
				status: "DROPPED",
				content: { tmdbId: 20, title: "Lost", type: "tv" },
				activity: [
					{
						type: "EPISODE_WATCHED",
						customDate: "2026-01-01T08:00:00.000Z",
						data: JSON.stringify({ season: 1, episode: 2 }),
					},
					{
						type: "EPISODE_WATCHED",
						customDate: "2026-01-02T10:00:00.000Z",
						data: JSON.stringify({ season: 1, episode: 2 }),
					},
				],
				watchedEpisodes: [
					{
						seasonNumber: 1,
						episodeNumber: 2,
						status: "FINISHED",
						createdAt: "2026-01-02T09:00:00.000Z",
					},
				],
			},
		]);

		const result = adaptWatcharrExport(exportJson);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			collectionMemberships: [{ collectionName: "Pinned" }],
			entityRef: {
				kind: "resolved",
				externalId: "10",
				scriptSlug: "movie.tmdb",
				entitySchemaSlug: "movie",
			},
			events: [
				{ eventSchemaSlug: "backlog", properties: {} },
				{ eventSchemaSlug: "review", properties: { rating: 70, text: "Soon" } },
			],
		});
		expect(result.entityGroups[1]).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "20",
				scriptSlug: "show.tmdb",
				entitySchemaSlug: "show",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-02T10:00:00.000Z",
					properties: { progressPercent: 100, showSeason: 1, showEpisode: 2 },
				},
				{
					eventSchemaSlug: "dropped",
					properties: { progressPercent: 1 },
					occurredAt: "2026-01-02T10:00:00.000Z",
				},
			],
		});
	});

	it("records malformed and unsupported source items", () => {
		const exportJson = JSON.stringify([
			{ pinned: true },
			{
				rating: 0,
				activity: [],
				thoughts: "",
				pinned: false,
				status: "PLANNED",
				watchedEpisodes: [],
				content: { tmdbId: 99, title: "Odd", type: "podcast" },
			},
		]);

		const result = adaptWatcharrExport(exportJson);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(2);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			message: "Watcharr item is malformed",
		});
		expect(result.failures[1]).toMatchObject({
			itemIndex: 1,
			sourceLabel: "Odd",
			sourceIdentifier: "99",
			message: "Unknown content type: podcast",
		});
	});
});
