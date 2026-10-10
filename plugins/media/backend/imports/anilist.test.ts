import { describe, expect, it } from "vitest";

import { adaptAnilistExport } from "./anilist";

describe("adaptAnilistExport", () => {
	it.each([1, 4, 5, 8, 10, 50, 100, 0])(
		"preserves a hundred-point rating of %s in lists and reviews",
		(score) => {
			const result = adaptAnilistExport(
				JSON.stringify({
					lists: [
						{ id: 1, score, progress: 0, series_id: 100, series_type: 0, progress_volume: 0 },
					],
					reviews: [
						{
							id: 2,
							score,
							text: "Review",
							series_id: 100,
							series_type: 0,
							summary: "Summary",
							updated_at: "2026-01-04 10:00:00",
						},
					],
				}),
				"Etc/GMT",
			);
			expect(result.failures).toEqual([]);
			const reviews = result.entityGroups
				.flatMap((group) => group.events)
				.filter((event) => event.eventSchemaSlug === "review");
			expect(reviews.map((event) => event.properties["rating"])).toEqual(
				score === 0 ? [undefined] : [score, score],
			);
			expect(reviews.map((event) => event.properties["text"])).toContain("Summary\n\nReview");
		},
	);

	it("maps cumulative progress, reviews, favorites, and custom lists", () => {
		const exportJson = JSON.stringify({
			favourites: [{ favourite_id: 200, favourite_type: 2 }],
			user: { custom_lists: { manga: ["Book Club"], anime: ["Watch Party"] } },
			reviews: [
				{
					id: 3,
					score: 90,
					series_id: 100,
					series_type: 0,
					text: "Detailed review",
					summary: "Short summary",
					updated_at: "2026-01-04 10:00:00",
				},
			],
			lists: [
				{
					id: 1,
					score: 8,
					progress: 2,
					series_id: 100,
					series_type: 0,
					progress_volume: 0,
					custom_lists: "[0]",
					notes: "Loved the pacing",
					updated_at: "2026-01-02 13:00:00",
				},
				{
					id: 2,
					score: 0,
					notes: "",
					progress: 3,
					series_id: 200,
					series_type: 1,
					progress_volume: 1,
					custom_lists: "[0]",
					updated_at: "2026-01-03 09:00:00",
				},
			],
		});

		const result = adaptAnilistExport(exportJson, "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			collectionMemberships: [{ collectionName: "Watch Party" }],
			entityRef: {
				kind: "resolved",
				externalId: "100",
				entitySchemaSlug: "anime",
				providerSlug: "anime.anilist",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { animeEpisode: 2 },
					occurredAt: "2026-01-02T13:00:00.000Z",
				},
				{
					eventSchemaSlug: "review",
					occurredAt: "2026-01-02T13:00:00.000Z",
					properties: { rating: 8, text: "Loved the pacing" },
				},
				{
					eventSchemaSlug: "review",
					occurredAt: "2026-01-04T10:00:00.000Z",
					properties: { rating: 90, text: "Short summary\n\nDetailed review" },
				},
			],
		});
		expect(result.entityGroups[1]).toMatchObject({
			collectionMemberships: [{ collectionName: "Book Club" }, { collectionName: "Favorite" }],
			events: [{ eventSchemaSlug: "progress", properties: { mangaVolume: 1, mangaChapter: 3 } }],
			entityRef: {
				kind: "resolved",
				externalId: "200",
				entitySchemaSlug: "manga",
				providerSlug: "manga.anilist",
			},
		});
		expect(result.entityGroups[1]?.events).toHaveLength(1);
	});

	it("maps list statuses to lifecycle events", () => {
		const exportJson = JSON.stringify({
			reviews: [],
			favourites: [],
			user: { custom_lists: { anime: [], manga: [] } },
			lists: [
				{
					id: 1,
					score: 0,
					progress: 0,
					series_id: 101,
					series_type: 0,
					status: "PLANNING",
					progress_volume: 0,
					custom_lists: "[]",
					updated_at: "2026-01-02 13:00:00",
				},
				{
					id: 2,
					score: 0,
					progress: 0,
					series_id: 102,
					series_type: 0,
					status: "CURRENT",
					custom_lists: "[]",
					progress_volume: 0,
					updated_at: "2026-01-02 13:00:00",
				},
				{
					id: 3,
					score: 0,
					progress: 0,
					series_id: 103,
					series_type: 0,
					status: "DROPPED",
					custom_lists: "[]",
					progress_volume: 0,
					updated_at: "2026-01-02 13:00:00",
				},
				{
					id: 4,
					score: 0,
					progress: 0,
					series_id: 104,
					series_type: 0,
					status: "PAUSED",
					custom_lists: "[]",
					progress_volume: 0,
					updated_at: "2026-01-02 13:00:00",
				},
				{
					id: 5,
					score: 0,
					progress: 0,
					series_id: 105,
					series_type: 0,
					custom_lists: "[]",
					progress_volume: 0,
					status: "COMPLETED",
					updated_at: "2026-01-02 13:00:00",
				},
			],
		});

		const result = adaptAnilistExport(exportJson, "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.entityGroups.map((group) => group.events)).toEqual([
			[{ properties: {}, eventSchemaSlug: "backlog", occurredAt: "2026-01-02T13:00:00.000Z" }],
			[{ properties: {}, eventSchemaSlug: "progress", occurredAt: "2026-01-02T13:00:00.000Z" }],
			[{ properties: {}, eventSchemaSlug: "dropped", occurredAt: "2026-01-02T13:00:00.000Z" }],
			[{ properties: {}, eventSchemaSlug: "on_hold", occurredAt: "2026-01-02T13:00:00.000Z" }],
			[
				{
					eventSchemaSlug: "complete",
					properties: { dateUnknown: true },
					occurredAt: "2026-01-02T13:00:00.000Z",
				},
			],
		]);
	});

	it("preserves volume-only progress without fabricating manga chapters", () => {
		const exportJson = JSON.stringify({
			reviews: [],
			favourites: [],
			user: { custom_lists: { anime: [], manga: [] } },
			lists: [
				{
					id: 1,
					score: 0,
					notes: "",
					progress: 0,
					series_id: 200,
					series_type: 1,
					custom_lists: "[]",
					progress_volume: 3,
					updated_at: "2026-01-03 09:00:00",
				},
			],
		});

		const result = adaptAnilistExport(exportJson, "Etc/GMT");

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			{
				itemIndex: 0,
				collectionMemberships: [],
				events: [
					{
						eventSchemaSlug: "progress",
						properties: { mangaVolume: 3 },
						occurredAt: "2026-01-03T09:00:00.000Z",
					},
				],
				entityRef: {
					kind: "resolved",
					externalId: "200",
					sourceLabel: "Manga 200",
					entitySchemaSlug: "manga",
					providerSlug: "manga.anilist",
				},
			},
		]);
	});

	it.each([
		{ progress: 0, progressVolume: -1 },
		{ progress: 0, progressVolume: 1.5 },
		{ progress: 0, progressVolume: Number.MAX_SAFE_INTEGER + 1 },
	])(
		"rejects invalid manga volume progress $progress/$progressVolume",
		({ progress, progressVolume }) => {
			const result = adaptAnilistExport(
				JSON.stringify({
					lists: [
						{
							id: 1,
							score: 0,
							progress,
							series_id: 200,
							series_type: 1,
							progress_volume: progressVolume,
						},
					],
				}),
				"Etc/GMT",
			);
			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toHaveLength(1);
			expect(result.failures[0]).toMatchObject({ itemIndex: 0 });
		},
	);

	it("records malformed source items without failing the whole export", () => {
		const exportJson = JSON.stringify({
			reviews: [],
			user: { custom_lists: { anime: [], manga: [] } },
			favourites: [{ favourite_id: 10, favourite_type: 9 }],
			lists: [
				{ id: 1, score: 8, progress: 1 },
				{
					id: 2,
					score: 8,
					notes: "",
					progress: 1,
					series_id: 2,
					series_type: 9,
					custom_lists: "[]",
					progress_volume: 0,
					updated_at: "2026-01-02 13:00:00",
				},
			],
		});

		const result = adaptAnilistExport(exportJson, "Etc/GMT");

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toHaveLength(3);
		expect(result.failures[0]).toMatchObject({
			itemIndex: 0,
			context: { issues: ["series_id"] },
			message: "Anilist list item is malformed",
		});
		expect(result.failures[1]).toMatchObject({
			itemIndex: 1,
			sourceIdentifier: "2",
			message: "Unsupported AniList series type: 9",
		});
		expect(result.failures[2]).toMatchObject({
			itemIndex: 2,
			sourceIdentifier: "10",
			message: "Unsupported AniList favorite type: 9",
		});
	});
});
