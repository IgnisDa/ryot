import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../test-utils";
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
					const url = new URL(String(args[1]));
					if (url.pathname.endsWith("/discover/movie")) {
						return httpSuccess({ results: [{ id: 2, title: "Film" }] });
					}
					if (url.pathname.endsWith("/discover/tv")) {
						return httpSuccess({ results: [{ id: 3, name: "Show" }] });
					}
					return httpSuccess({ name: "Studio", logo_path: null, origin_country: "US" });
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details["relatedEntityGroups"]).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
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
					synchronization: "authoritative",
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
			return undefined;
		}));

	it("uses paginated discover endpoints for company productions", () => {
		const requests: Array<{ page: string | null; path: string; company: string | null }> = [];

		return runTmdbCompanyDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: () => hostSuccess("token"),
				httpCall: (...args: Array<unknown>) => {
					const url = new URL(String(args[1]));
					if (url.pathname.endsWith("/company/1")) {
						return httpSuccess({ name: "Studio", logo_path: null, origin_country: "US" });
					}

					requests.push({
						path: url.pathname,
						page: url.searchParams.get("page"),
						company: url.searchParams.get("with_companies"),
					});
					const page = url.searchParams.get("page");
					if (url.pathname.endsWith("/discover/movie")) {
						return httpSuccess({
							total_pages: 2,
							results: page === "1" ? [{ id: 2, title: "Film" }] : [{ id: 4, title: "Sequel" }],
						});
					}

					return httpSuccess({
						total_pages: 2,
						results: page === "1" ? [{ id: 3, name: "Show" }] : [{ id: 5, name: "Follow-up" }],
					});
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(requests).toEqual(
				expect.arrayContaining([
					{ path: "/3/discover/movie", company: "1", page: "1" },
					{ path: "/3/discover/movie", company: "1", page: "2" },
					{ path: "/3/discover/tv", company: "1", page: "1" },
					{ path: "/3/discover/tv", company: "1", page: "2" },
				]),
			);
			expect(details["relatedEntityGroups"]).toEqual([
				expect.objectContaining({
					entities: expect.arrayContaining([
						expect.objectContaining({ externalId: "2" }),
						expect.objectContaining({ externalId: "4" }),
					]),
				}),
				expect.objectContaining({
					entities: expect.arrayContaining([
						expect.objectContaining({ externalId: "3" }),
						expect.objectContaining({ externalId: "5" }),
					]),
				}),
			]);
			return undefined;
		});
	});
});
