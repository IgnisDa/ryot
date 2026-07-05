import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./tmdb";
import details, { manifest as detailsManifest } from "./tmdb-details.sandbox";
import resolve, { manifest as resolveManifest } from "./tmdb-resolve.sandbox";
import search, { manifest as searchManifest } from "./tmdb-search.sandbox";
import translate, { manifest as translateManifest } from "./tmdb-translate.sandbox";
import trending, { manifest as trendingManifest } from "./tmdb-trending.sandbox";

type TmdbHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({
		status: 200,
		headers: {},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("token"),
		getUserPreferences: () => Effect.succeed({ isNsfw: false, disableIntegrations: false }),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("show.tmdb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
			[resolveManifest.slug, resolve.operation, resolveManifest.capabilities],
			[translateManifest.slug, translate.operation, translateManifest.capabilities],
		]).toEqual([
			["show.tmdb.search", "search", ["httpCall", "getAppConfigValue", "getUserPreferences"]],
			["show.tmdb.details", "details", ["httpCall", "getAppConfigValue"]],
			["show.tmdb.resolve", "resolve", ["httpCall", "getAppConfigValue"]],
			["show.tmdb.translate", "translate", ["httpCall", "getAppConfigValue"]],
		]);
	});
	it("declares trending as a generic provider-associated script", () => {
		expect({
			kind: trendingManifest.kind,
			slug: trendingManifest.slug,
			operation: "operation" in trending ? trending.operation : null,
			capabilities: trendingManifest.capabilities,
			requiredAppConfigKeys: trendingManifest.requiredAppConfigKeys,
		}).toEqual({
			kind: "script",
			slug: "show.tmdb.trending",
			operation: null,
			capabilities: ["httpCall", "getAppConfigValue"],
			requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
		});
	});
	it("keeps TMDB recommendations as related entities", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/tv/1/recommendations")) {
				return httpSuccess({
					results: [
						{ id: 2, title: "Pick One", name: "Pick One" },
						{ id: 3, title: "Pick Two", name: "Pick Two" },
					],
				});
			}
			if (url.includes("/tv/1/credits")) {
				return httpSuccess({ cast: [], crew: [] });
			}
			if (url.includes("/tv/1/images")) {
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
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-show",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-show",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Pick One", externalId: "2", providerSlug: "show.tmdb" },
								{ name: "Pick Two", externalId: "3", providerSlug: "show.tmdb" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("returns TMDB trending shows", () => {
		const requestedPages: string[] = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
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
			return requestUrl.searchParams.get("page") === "2"
				? httpSuccess({ results: [{ id: 40, name: "Third Show" }] })
				: httpSuccess({ results: [{ id: 50, name: "Fourth Show" }] });
		});
		return Effect.runPromise(
			runSandboxTestScript(trending, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(requestedPages).toEqual(["1", "2", "3"]);
					expect(result).toEqual({
						items: [
							{ name: "First Show", externalId: "10" },
							{ name: "Second Show", externalId: "20" },
							{ name: "Third Show", externalId: "40" },
							{ name: "Fourth Show", externalId: "50" },
						],
					});
					return undefined;
				}),
			),
		);
	});
});
