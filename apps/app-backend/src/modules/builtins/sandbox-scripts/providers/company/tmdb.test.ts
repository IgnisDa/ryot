import { describe, expect, it } from "vitest";

import { type HostFunction, hostSuccess, httpSuccess, runProviderDriver, toRecord } from "../test-utils";
import tmdbCompanyScriptCode from "./tmdb.sandbox.js" with { type: "text" };

const runTmdbCompanyDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(tmdbCompanyScriptCode, context, hostFunctions);

describe("company.tmdb sandbox script", () => {
	it("emits separate movie and show company groups", () =>
		runTmdbCompanyDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const url = String(args[1]);
					if (url.includes("/movies")) {
						return httpSuccess({ results: [{ id: 2, title: "Film" }] });
					}
					if (url.includes("/tv")) {
						return httpSuccess({ results: [{ id: 3, name: "Show" }] });
					}
					return httpSuccess({ name: "Studio", logo_path: null, origin_country: "US" });
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					relationshipSchemaSlug: "company-to-movie",
					entities: [
						{
							name: "Film",
							externalId: "2",
							scriptSlug: "movie.tmdb",
							relationshipProperties: { roles: ["Production Company"] },
						},
					],
				},
				{
					direction: "outgoing",
					relationshipSchemaSlug: "company-to-show",
					entities: [
						{
							name: "Show",
							externalId: "3",
							scriptSlug: "show.tmdb",
							relationshipProperties: { roles: ["Production Company"] },
						},
					],
				},
			]);
		}),
	);
});
