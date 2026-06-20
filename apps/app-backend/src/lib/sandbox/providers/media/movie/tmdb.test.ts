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
			expect(details.relatedEntities).toEqual([
				{
					name: "Pick One",
					externalId: "2",
					scriptSlug: "movie.tmdb",
					relationshipSchemaSlug: "media-suggestion",
				},
				{
					name: "Pick Two",
					externalId: "3",
					scriptSlug: "movie.tmdb",
					relationshipSchemaSlug: "media-suggestion",
				},
			]);
			return undefined;
		});
	});
});
