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
		getPluginConfigValue: () => Effect.succeed("token"),
		getUserPreferences: () => Effect.succeed({ isNsfw: false, disableIntegrations: false }),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("movie.tmdb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
			[resolveManifest.slug, resolve.operation, resolveManifest.capabilities],
			[translateManifest.slug, translate.operation, translateManifest.capabilities],
		]).toEqual([
			["movie.tmdb.search", "search", ["httpCall", "getPluginConfigValue", "getUserPreferences"]],
			["movie.tmdb.details", "details", ["httpCall", "getPluginConfigValue"]],
			["movie.tmdb.resolve", "resolve", ["httpCall", "getPluginConfigValue"]],
			["movie.tmdb.translate", "translate", ["httpCall", "getPluginConfigValue"]],
		]);
	});
	it("declares trending as a generic provider-associated script", () => {
		expect({
			kind: trendingManifest.kind,
			slug: trendingManifest.slug,
			operation: "operation" in trending ? trending.operation : null,
			capabilities: trendingManifest.capabilities,
			requiredPluginConfigKeys: trendingManifest.requiredPluginConfigKeys,
		}).toEqual({
			kind: "script",
			slug: "movie.tmdb.trending",
			operation: null,
			capabilities: ["httpCall", "getPluginConfigValue"],
			requiredPluginConfigKeys: ["tmdbAccessToken"],
		});
	});
	it("keeps TMDB recommendations as related entities", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/movie/1/recommendations")) {
				return httpSuccess({
					results: [
						{ id: 2, title: "Pick One", name: "Pick One" },
						{ id: 3, title: "Pick Two", name: "Pick Two" },
					],
				});
			}
			if (url.includes("/movie/1/credits")) {
				return httpSuccess({ cast: [], crew: [] });
			}
			if (url.includes("/movie/1/images")) {
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
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-movie",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
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
								{ name: "Pick One", externalId: "2", providerSlug: "movie.tmdb" },
								{ name: "Pick Two", externalId: "3", providerSlug: "movie.tmdb" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("returns TMDB trending movies", () => {
		const requestedPages: string[] = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
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
			return requestUrl.searchParams.get("page") === "2"
				? httpSuccess({ results: [{ id: 4, title: "Third Movie" }] })
				: httpSuccess({ results: [{ id: 5, title: "Fourth Movie" }] });
		});
		return Effect.runPromise(
			runSandboxTestScript(trending, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(requestedPages).toEqual(["1", "2", "3"]);
					expect(result).toEqual({
						items: [
							{ name: "First Movie", externalId: "1" },
							{ name: "Second Movie", externalId: "2" },
							{ name: "Third Movie", externalId: "4" },
							{ name: "Fourth Movie", externalId: "5" },
						],
					});
					return undefined;
				}),
			),
		);
	});
});
