import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./tmdb.sandbox";

type TmdbHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ data: "token", success: true }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("company.tmdb sandbox script", () => {
	it("emits separate movie and show company groups", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (requestUrl.pathname.endsWith("/discover/movie")) {
				return httpSuccess({ results: [{ id: 2, title: "Film" }] });
			}
			if (requestUrl.pathname.endsWith("/discover/tv")) {
				return httpSuccess({ results: [{ id: 3, name: "Show" }] });
			}
			return httpSuccess({ name: "Studio", logo_path: null, origin_country: "US" });
		});

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.relatedEntityGroups).toEqual([
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
		});
	});

	it("uses paginated discover endpoints for company productions", () => {
		const requests: Array<{ page: string | null; path: string; company: string | null }> = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (requestUrl.pathname.endsWith("/company/1")) {
				return httpSuccess({ name: "Studio", logo_path: null, origin_country: "US" });
			}
			requests.push({
				path: requestUrl.pathname,
				page: requestUrl.searchParams.get("page"),
				company: requestUrl.searchParams.get("with_companies"),
			});
			const page = requestUrl.searchParams.get("page");
			return requestUrl.pathname.endsWith("/discover/movie")
				? httpSuccess({
						total_pages: 2,
						results: page === "1" ? [{ id: 2, title: "Film" }] : [{ id: 4, title: "Sequel" }],
					})
				: httpSuccess({
						total_pages: 2,
						results: page === "1" ? [{ id: 3, name: "Show" }] : [{ id: 5, name: "Follow-up" }],
					});
		});

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(requests).toEqual(
				expect.arrayContaining([
					{ path: "/3/discover/movie", company: "1", page: "1" },
					{ path: "/3/discover/movie", company: "1", page: "2" },
					{ path: "/3/discover/tv", company: "1", page: "1" },
					{ path: "/3/discover/tv", company: "1", page: "2" },
				]),
			);
			expect(result.relatedEntityGroups).toEqual([
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
