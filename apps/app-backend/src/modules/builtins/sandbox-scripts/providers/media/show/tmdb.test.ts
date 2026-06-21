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

const runTmdbShowTrending = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(tmdbShowScriptCode, context, hostFunctions, {
		driverName: "trending",
		metadata: { providerInformation: { source: "tmdb", canonicalLanguage: "en" } },
	});

describe("show.tmdb sandbox script", () => {
	it("keeps TMDB recommendations as related entities", () => {
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
			expect(details["relatedEntityGroups"]).toEqual([
				{
					direction: "incoming",
					synchronization: "additive",
					entities: [],
					relationshipSchemaSlug: "person-to-show",
				},
				{
					direction: "incoming",
					synchronization: "additive",
					entities: [],
					relationshipSchemaSlug: "company-to-show",
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Pick One", externalId: "2", scriptSlug: "show.tmdb" },
						{ name: "Pick Two", externalId: "3", scriptSlug: "show.tmdb" },
					],
				},
			]);
			return undefined;
		});
	});
	it("returns TMDB trending shows", () => {
		const requestedPages: string[] = [];
		return runTmdbShowTrending(
			{},
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = new URL(String(args[1]));
					expect(requestUrl.pathname).toBe("/3/trending/tv/day");
					requestedPages.push(requestUrl.searchParams.get("page") ?? "");

					if (requestUrl.searchParams.get("page") === "1") {
						return httpSuccess({
							results: [
								{ id: 10, name: "First Show" },
								{ id: 20, original_name: "Second Show" },
								{ id: 30, name: "" },
							],
						});
					}
					if (requestUrl.searchParams.get("page") === "2") {
						return httpSuccess({ results: [{ id: 40, name: "Third Show" }] });
					}
					return httpSuccess({ results: [{ id: 50, name: "Fourth Show" }] });
				},
			},
		).then((rawResult) => {
			expect(requestedPages).toEqual(["1", "2", "3"]);
			expect(toRecord(rawResult)).toEqual({
				items: [
					{ name: "First Show", externalId: "10" },
					{ name: "Second Show", externalId: "20" },
					{ name: "Third Show", externalId: "40" },
					{ name: "Fourth Show", externalId: "50" },
				],
			});
			return undefined;
		});
	});
});
