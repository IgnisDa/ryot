import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../../test-utils";
import tmdbShowScriptCode from "./tmdb.sandbox.js" with { type: "text" };

const runTmdbShowDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(tmdbShowScriptCode, context, hostFunctions, {
		metadata: { providerInformation: { source: "tmdb", canonicalLanguage: "en" } },
	});

describe("show.tmdb sandbox script", () => {
	it("keeps TMDB recommendations in suggestions", () => {
		return runTmdbShowDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = String(args[1]);
					if (requestUrl.includes("/tv/1/recommendations")) {
						return httpSuccess({
							results: [
								{ id: 2, title: "Pick One", name: "Pick One" },
								{ id: 3, title: "Pick Two", name: "Pick Two" },
							],
						});
					}
					if (requestUrl.includes("/tv/1/credits")) {
						return httpSuccess({ cast: [], crew: [] });
					}
					if (requestUrl.includes("/tv/1/images")) {
						return httpSuccess({ posters: [], backdrops: [] });
					}
					return httpSuccess({
						id: 1,
						genres: [],
						seasons: [],
						networks: [],
						adult: false,
						name: "Source",
						created_by: [],
						overview: null,
						status: "Ended",
						poster_path: null,
						vote_average: 7.5,
						backdrop_path: null,
						production_companies: [],
						first_air_date: "2024-01-01",
					});
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.suggestions).toEqual([
				{ name: "Pick One", externalId: "2", scriptSlug: "show.tmdb" },
				{ name: "Pick Two", externalId: "3", scriptSlug: "show.tmdb" },
			]);
			return undefined;
		});
	});
});
