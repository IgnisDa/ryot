import { describe, expect, it } from "bun:test";

import { adaptAnilistExport } from "./adapter";

describe("adaptAnilistExport", () => {
	it("maps progress coverage, reviews, favorites, and custom lists", () => {
		const exportJson = JSON.stringify({
			user: { custom_lists: { anime: ["Watch Party"], manga: ["Book Club"] } },
			favourites: [{ favourite_id: 200, favourite_type: 2 }],
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
				scriptSlug: "anime.anilist",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-02T13:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 1 },
				},
				{
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-02T13:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 2 },
				},
				{
					eventSchemaSlug: "review",
					occurredAt: "2026-01-02T13:00:00.000Z",
					properties: { rating: 80, text: "Loved the pacing" },
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
			entityRef: {
				kind: "resolved",
				externalId: "200",
				entitySchemaSlug: "manga",
				scriptSlug: "manga.anilist",
			},
			events: [
				{ properties: { progressPercent: 100, mangaChapter: 1 } },
				{ properties: { progressPercent: 100, mangaChapter: 2 } },
				{ properties: { progressPercent: 100, mangaChapter: 3 } },
			],
		});
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
			[
				{
					eventSchemaSlug: "progress",
					properties: { progressPercent: 1 },
					occurredAt: "2026-01-02T13:00:00.000Z",
				},
			],
			[
				{
					eventSchemaSlug: "dropped",
					properties: { progressPercent: 1 },
					occurredAt: "2026-01-02T13:00:00.000Z",
				},
			],
			[
				{
					eventSchemaSlug: "on_hold",
					properties: { progressPercent: 1 },
					occurredAt: "2026-01-02T13:00:00.000Z",
				},
			],
			[
				{
					eventSchemaSlug: "complete",
					occurredAt: "2026-01-02T13:00:00.000Z",
					properties: { completionMode: "unknown" },
				},
			],
		]);
	});

	it("does not fabricate manga chapter coverage from volume-only progress", () => {
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
				events: [],
				itemIndex: 0,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: "200",
					sourceLabel: "Manga 200",
					entitySchemaSlug: "manga",
					scriptSlug: "manga.anilist",
				},
			},
		]);
	});

	it("records malformed source items without failing the whole export", () => {
		const exportJson = JSON.stringify({
			reviews: [],
			user: { custom_lists: { anime: [], manga: [] } },
			favourites: [{ favourite_id: 10, favourite_type: 9 }],
			lists: [
				{ id: 1, progress: 1, score: 8 },
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
