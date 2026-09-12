import { describe, expect, it } from "vitest";

import { adaptImdbCsv } from "./imdb";

const IMDB_HEADERS = "Const,Title,Title Type";

describe("adaptImdbCsv", () => {
	it("maps watchlist rows to backlog events grouped by IMDb id", () => {
		const csv = [
			IMDB_HEADERS,
			"tt0111161,The Shawshank Redemption,Movie",
			"tt0944947,Game of Thrones,TV Series",
		].join("\n");

		const result = adaptImdbCsv(csv);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups).toHaveLength(2);
		expect(result.entityGroups.map((group) => group.entityRef)).toEqual([
			{
				kind: "unresolved",
				identifierType: "imdb",
				entitySchemaSlug: "movie",
				identifierValue: "tt0111161",
				sourceLabel: "The Shawshank Redemption",
			},
			{
				kind: "unresolved",
				identifierType: "imdb",
				entitySchemaSlug: "show",
				identifierValue: "tt0944947",
				sourceLabel: "Game of Thrones",
			},
		]);
		expect(
			result.entityGroups.every((group) => group.events[0]?.eventSchemaSlug === "backlog"),
		).toBe(true);
	});

	it("imports watched history and ratings instead of backlog events", () => {
		const result = adaptImdbCsv(
			"Const,Title,Title Type,Your Rating,Date Rated\ntt0111161,The Shawshank Redemption,movie,9,2023-08-15",
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.collectionMemberships).toEqual([]);
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2023-08-15T00:00:00.000Z",
				properties: {
					consumedOn: "imdb",
					completionMode: "custom_timestamps",
					completedOn: "2023-08-15T00:00:00.000Z",
				},
			},
			{
				eventSchemaSlug: "review",
				properties: { rating: 90 },
				occurredAt: "2023-08-15T00:00:00.000Z",
			},
		]);
	});

	it.each([1, 5, 9.5, 10])("scales rating %s and records an unknown completion date", (rating) => {
		const result = adaptImdbCsv(`Const,Title Type,Your Rating\ntt0111161,movie,${rating}`);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: expect.any(String),
				properties: { consumedOn: "imdb", completionMode: "unknown" },
			},
			{
				eventSchemaSlug: "review",
				properties: { rating: rating * 10 },
				occurredAt: result.entityGroups[0]?.events[0]?.occurredAt,
			},
		]);
	});

	it.each(["2023-08-15", "2023/08/15"])("imports rated date %s without a rating", (date) => {
		const result = adaptImdbCsv(
			`Const,Title Type,Your Rating,Date Rated\ntt0944947,tvSeries,, ${date} `,
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.events).toEqual([
			{
				eventSchemaSlug: "complete",
				occurredAt: "2023-08-15T00:00:00.000Z",
				properties: {
					consumedOn: "imdb",
					completionMode: "custom_timestamps",
					completedOn: "2023-08-15T00:00:00.000Z",
				},
			},
		]);
	});

	it("keeps entries with blank rating and rated date on the backlog", () => {
		const result = adaptImdbCsv("Const,Title Type,Your Rating,Date Rated\ntt0111161,movie, , ");

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.events).toEqual([
			{ properties: {}, eventSchemaSlug: "backlog", occurredAt: expect.any(String) },
		]);
	});

	it.each(["0", "11", "bad", "9stars", "Infinity"])("rejects invalid rating %s", (rating) => {
		const result = adaptImdbCsv(
			[
				"Const,Title,Title Type,Your Rating,Date Rated",
				`tt0111161,Invalid Movie,movie,${rating},2023-08-15`,
				"tt0944947,Valid Show,tvSeries,8,2023-08-15",
			].join("\n"),
		);

		expect(result.totalItems).toBe(2);
		expect(result.entityGroups).toHaveLength(1);
		expect(result.entityGroups[0]?.itemIndex).toBe(1);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				sourceLabel: "Invalid Movie",
				sourceIdentifier: "tt0111161",
				message: `Invalid rating '${rating}', must be between 1 and 10`,
			},
		]);
	});

	it.each(["not-a-date", "2023-02-29", "2023/04/31", "2023-13-01"])(
		"rejects invalid rated date %s before creating events",
		(date) => {
			const result = adaptImdbCsv(
				`Const,Title,Title Type,Your Rating,Date Rated\ntt0111161,Invalid Movie,movie,9,${date}`,
			);

			expect(result.entityGroups).toEqual([]);
			expect(result.failures).toEqual([
				{
					itemIndex: 0,
					sourceLabel: "Invalid Movie",
					sourceIdentifier: "tt0111161",
					message: `Invalid date rated '${date}'`,
				},
			]);
		},
	);

	it("records row-level failures for missing ids and unknown title types", () => {
		const csv = [IMDB_HEADERS, ",Broken Movie,Movie", "tt1234567,Odd Item,Podcast"].join("\n");

		const result = adaptImdbCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{ itemIndex: 0, message: "Const is empty", sourceLabel: "Broken Movie" },
			{
				itemIndex: 1,
				sourceLabel: "Odd Item",
				sourceIdentifier: "tt1234567",
				message: "Unknown title type: Podcast",
			},
		]);
	});
});
