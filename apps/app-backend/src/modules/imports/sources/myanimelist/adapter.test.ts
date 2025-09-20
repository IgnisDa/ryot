import { describe, expect, it } from "bun:test";

import { adaptMyanimelistExports } from "./adapter";

describe("adaptMyanimelistExports", () => {
	it("maps anime and manga exports into coverage, lifecycle, and review events", () => {
		const animeXml = `
			<myanimelist>
				<anime>
					<series_animedb_id>101</series_animedb_id>
					<series_title>Frieren</series_title>
					<my_watched_episodes>2</my_watched_episodes>
					<my_start_date>2026-01-01</my_start_date>
					<my_finish_date>2026-01-02</my_finish_date>
					<my_score>8</my_score>
					<my_status>Completed</my_status>
				</anime>
			</myanimelist>
		`;
		const mangaXml = `
			<myanimelist>
				<manga>
					<manga_mangadb_id>202</manga_mangadb_id>
					<manga_title>Vinland Saga</manga_title>
					<my_read_chapters>0</my_read_chapters>
					<my_start_date>0000-00-00</my_start_date>
					<my_finish_date>0000-00-00</my_finish_date>
					<my_score>0</my_score>
					<my_status>Plan to Read</my_status>
				</manga>
			</myanimelist>
		`;

		const result = adaptMyanimelistExports({ animeXml, mangaXml });

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: {
				kind: "resolved",
				externalId: "101",
				entitySchemaSlug: "anime",
				scriptSlug: "anime.myanimelist",
			},
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-02T00:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 1 },
				},
				{
					eventSchemaSlug: "progress",
					occurredAt: "2026-01-02T00:00:00.000Z",
					properties: { progressPercent: 100, animeEpisode: 2 },
				},
				{
					eventSchemaSlug: "review",
					properties: { rating: 80 },
					occurredAt: "2026-01-02T00:00:00.000Z",
				},
			],
		});
		expect(result.entityGroups[1]).toMatchObject({
			events: [{ eventSchemaSlug: "backlog", properties: {} }],
			entityRef: {
				kind: "resolved",
				externalId: "202",
				entitySchemaSlug: "manga",
				scriptSlug: "manga.myanimelist",
			},
		});
	});

	it("keeps lifecycle events when coverage progress exists", () => {
		const animeXml = `
			<myanimelist>
				<anime>
					<series_animedb_id>303</series_animedb_id>
					<series_title>Dropped Show</series_title>
					<my_watched_episodes>1</my_watched_episodes>
					<my_start_date>2026-01-01</my_start_date>
					<my_finish_date>0000-00-00</my_finish_date>
					<my_score>0</my_score>
					<my_status>Dropped</my_status>
				</anime>
			</myanimelist>
		`;

		const result = adaptMyanimelistExports({ animeXml });

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "progress",
				occurredAt: "2026-01-01T00:00:00.000Z",
				properties: { progressPercent: 100, animeEpisode: 1 },
			},
			{
				eventSchemaSlug: "dropped",
				properties: { progressPercent: 1 },
				occurredAt: "2026-01-01T00:00:00.000Z",
			},
		]);
	});

	it("records malformed XML items as row failures", () => {
		const animeXml = `
			<myanimelist>
				<anime>
					<series_title>Broken Entry</series_title>
					<my_watched_episodes>1</my_watched_episodes>
					<my_start_date>2026-01-01</my_start_date>
					<my_finish_date>2026-01-02</my_finish_date>
					<my_score>7</my_score>
				</anime>
			</myanimelist>
		`;

		const result = adaptMyanimelistExports({ animeXml });

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([{ itemIndex: 0, message: "series_animedb_id is empty" }]);
	});
});
