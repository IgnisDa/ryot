import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../../test-utils";
import tmdbMovieScriptCode from "./tmdb.sandbox.js" with { type: "text" };

const runTmdbMovieDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(tmdbMovieScriptCode, context, hostFunctions, {
		metadata: { providerInformation: { source: "tmdb", canonicalLanguage: "en" } },
	});

const runTmdbMovieTrending = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(tmdbMovieScriptCode, context, hostFunctions, {
		driverName: "trending",
		metadata: { providerInformation: { source: "tmdb", canonicalLanguage: "en" } },
	});

describe("movie.tmdb sandbox script", () => {
	it("keeps TMDB recommendations as related entities", () => {
		return runTmdbMovieDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = String(args[1]);
					if (requestUrl.includes("/movie/1/recommendations")) {
						return httpSuccess({
							results: [
								{ id: 2, title: "Pick One", name: "Pick One" },
								{ id: 3, title: "Pick Two", name: "Pick Two" },
							],
						});
					}
					if (requestUrl.includes("/movie/1/credits")) {
						return httpSuccess({ cast: [], crew: [] });
					}
					if (requestUrl.includes("/movie/1/images")) {
						return httpSuccess({ posters: [], backdrops: [] });
					}
					return httpSuccess({
						id: 1,
						genres: [],
						adult: false,
						runtime: 120,
						overview: null,
						title: "Source",
						poster_path: null,
						vote_average: 7.5,
						status: "Released",
						backdrop_path: null,
						production_companies: [],
						release_date: "2024-01-01",
						belongs_to_collection: null,
					});
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details["relatedEntityGroups"]).toEqual([
				{
					direction: "incoming",
					synchronization: "additive",
					entities: [],
					relationshipSchemaSlug: "person-to-movie",
				},
				{
					direction: "incoming",
					synchronization: "additive",
					entities: [],
					relationshipSchemaSlug: "company-to-movie",
				},
				{
					entities: [],
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "movie-group-to-movie",
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Pick One", externalId: "2", scriptSlug: "movie.tmdb" },
						{ name: "Pick Two", externalId: "3", scriptSlug: "movie.tmdb" },
					],
				},
			]);
			return undefined;
		});
	});
	it("returns TMDB trending movies", () => {
		const requestedPages: string[] = [];
		return runTmdbMovieTrending(
			{},
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = new URL(String(args[1]));
					expect(requestUrl.pathname).toBe("/3/trending/movie/day");
					requestedPages.push(requestUrl.searchParams.get("page") ?? "");

					if (requestUrl.searchParams.get("page") === "1") {
						return httpSuccess({
							results: [
								{ id: 1, title: "First Movie" },
								{ id: 2, original_title: "Second Movie" },
								{ id: 3, title: "" },
							],
						});
					}
					if (requestUrl.searchParams.get("page") === "2") {
						return httpSuccess({ results: [{ id: 4, title: "Third Movie" }] });
					}
					return httpSuccess({ results: [{ id: 5, title: "Fourth Movie" }] });
				},
			},
		).then((rawResult) => {
			expect(requestedPages).toEqual(["1", "2", "3"]);
			expect(toRecord(rawResult)).toEqual({
				items: [
					{ name: "First Movie", externalId: "1" },
					{ name: "Second Movie", externalId: "2" },
					{ name: "Third Movie", externalId: "4" },
					{ name: "Fourth Movie", externalId: "5" },
				],
			});
			return undefined;
		});
	});
});
