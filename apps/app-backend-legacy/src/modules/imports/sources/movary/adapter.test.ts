import { describe, expect, it } from "bun:test";

import { adaptMovaryExports } from "./adapter";

describe("adaptMovaryExports", () => {
	it("maps Movary history, ratings, and watchlist rows onto movie events", () => {
		const result = adaptMovaryExports(
			{
				watchlistCsv: ["title,tmdb_id", "Arrival,42"].join("\n"),
				ratingsCsv: ["title,tmdbId,userRating", "Arrival,42,8.5"].join("\n"),
				historyCsv: [
					"title,tmdb_id,watched_at,comment",
					"Arrival,42,2026-01-03,Excellent ending",
				].join("\n"),
			},
			{ now: () => "2026-01-10T00:00:00.000Z" },
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toEqual([
			{
				itemIndex: 0,
				collectionMemberships: [],
				entityRef: {
					kind: "resolved",
					externalId: "42",
					sourceLabel: "Arrival",
					scriptSlug: "movie.tmdb",
					entitySchemaSlug: "movie",
				},
				events: [
					{
						eventSchemaSlug: "complete",
						occurredAt: "2026-01-03T00:00:00.000Z",
						properties: {
							completionMode: "custom_timestamps",
							completedOn: "2026-01-03T00:00:00.000Z",
						},
					},
					{
						eventSchemaSlug: "review",
						occurredAt: "2026-01-03T00:00:00.000Z",
						properties: { text: "Excellent ending" },
					},
					{
						eventSchemaSlug: "review",
						properties: { rating: 85 },
						occurredAt: "2026-01-10T00:00:00.000Z",
					},
					{
						properties: {},
						eventSchemaSlug: "backlog",
						occurredAt: "2026-01-10T00:00:00.000Z",
					},
				],
			},
		]);
	});

	it("records per-file row failures with stable item indices", () => {
		const result = adaptMovaryExports(
			{
				watchlistCsv: ["title,tmdb_id", "Missing Id,,"].join("\n"),
				ratingsCsv: ["title,tmdb_id,user_rating", "Bad Rating,99,12"].join("\n"),
				historyCsv: ["title,tmdb_id,watched_at", "Broken Date,42,nope"].join("\n"),
			},
			{ now: () => "2026-01-10T00:00:00.000Z" },
		);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceIdentifier: "42",
				sourceLabel: "Broken Date",
				message: "History file: watched_at is invalid",
			},
			{
				itemIndex: 1,
				sourceIdentifier: "99",
				sourceLabel: "Bad Rating",
				message: "Ratings file: user_rating must be a number between 0 and 10",
			},
			{
				itemIndex: 2,
				sourceLabel: "Missing Id",
				message: "Watchlist file: Row is missing TMDB id",
			},
		]);
	});

	it("accepts either snake_case or camelCase Movary headers", () => {
		const result = adaptMovaryExports(
			{
				watchlistCsv: ["title,tmdbId", "Alien,55"].join("\n"),
				ratingsCsv: ["title,tmdb_id,userRating", "Alien,55,7"].join("\n"),
				historyCsv: ["title,tmdbId,watchedAt", "Alien,55,2026-02-01"].join("\n"),
			},
			{ now: () => "2026-02-10T00:00:00.000Z" },
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			externalId: "55",
			scriptSlug: "movie.tmdb",
			entitySchemaSlug: "movie",
		});
	});
});
