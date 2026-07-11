import { expect, it } from "vitest";

import { adaptTraktExport, classifyTraktExportName } from "./trakt";

const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(JSON.stringify(value));

it("imports paged Trakt export activity and resolves custom list metadata", () => {
	const result = adaptTraktExport({
		"lists-lists.json": json([
			{ name: "Top Movies", ids: { trakt: 42 }, description: "Favorites" },
		]),
		"lists-list-42-top-movies.json": json([
			{ movie: { year: null, title: "Arrival", ids: { trakt: 1, tmdb: 329865 } } },
		]),
		"watched-history.json": json([
			{
				watched_at: "2024-01-01T00:00:00Z",
				show: { title: "Incomplete", ids: { trakt: 3, tmdb: 100 } },
			},
		]),
		"ratings-seasons.json": json([
			{
				rating: 9,
				rated_at: "2024-02-02T00:00:00Z",
				season: { number: 1, ids: { trakt: 40, tmdb: 400 } },
				show: { title: "Severance", ids: { trakt: 4, tmdb: 95396 } },
			},
		]),
		"ratings-episodes-10.json": json([
			{
				rating: 8,
				rated_at: "2024-02-01T00:00:00Z",
				show: { title: "Dark", ids: { trakt: 2, tmdb: 70523 } },
				episode: { season: 2, number: 4, ids: { trakt: 20, imdb: null, tmdb: null } },
			},
		]),
	});

	expect(result.totalItems).toBe(4);
	expect(result.failures).toEqual([
		expect.objectContaining({ message: "Show history item has no episode coordinates" }),
	]);
	expect(result.entityGroups).toEqual([
		expect.objectContaining({
			entityRef: expect.objectContaining({ externalId: "95396" }),
			events: [
				expect.objectContaining({
					eventSchemaSlug: "review",
					properties: { rating: 90 },
					unresolvedEpisode: { seasonNumber: 1, type: "show-season" },
				}),
			],
		}),
		expect.objectContaining({
			entityRef: expect.objectContaining({ externalId: "70523" }),
			events: [
				expect.objectContaining({
					eventSchemaSlug: "review",
					properties: { rating: 80 },
					unresolvedEpisode: { type: "show", seasonNumber: 2, episodeNumber: 4 },
				}),
			],
		}),
		expect.objectContaining({
			collectionMemberships: [{ collectionName: "Top Movies" }],
			entityRef: expect.objectContaining({ externalId: "329865" }),
		}),
	]);
});

it("rejects malformed or unrecognized exports and ignores aggregate watched files", () => {
	expect(() => adaptTraktExport({ "ratings-movies.json": encoder.encode("not json") })).toThrow(
		"Invalid JSON in Trakt export entry ratings-movies.json",
	);
	expect(() => adaptTraktExport({ "profile.json": json({}) })).toThrow(
		"Trakt export ZIP does not contain any recognized files",
	);
	expect(classifyTraktExportName("watched-movies.json")).toBeUndefined();
	expect(classifyTraktExportName("ratings-movies-2.json")?.page).toBe(2);
	expect(classifyTraktExportName("ratings-movies-10.json")?.page).toBe(10);
});
