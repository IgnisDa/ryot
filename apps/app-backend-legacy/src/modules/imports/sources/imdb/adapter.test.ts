import { describe, expect, it } from "bun:test";

import { adaptImdbCsv } from "./adapter";

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

	it("records row-level failures for missing ids and unknown title types", () => {
		const csv = [IMDB_HEADERS, ",Broken Movie,Movie", "tt1234567,Odd Item,Podcast"].join("\n");

		const result = adaptImdbCsv(csv);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{ itemIndex: 0, sourceLabel: "Broken Movie", message: "Const is empty" },
			{
				itemIndex: 1,
				sourceLabel: "Odd Item",
				sourceIdentifier: "tt1234567",
				message: "Unknown title type: Podcast",
			},
		]);
	});
});
