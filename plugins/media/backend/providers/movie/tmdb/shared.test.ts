import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import resolve, { manifest as resolveManifest } from "./resolve.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";
import translate, { manifest as translateManifest } from "./translate.sandbox";
import trending, { manifest as trendingManifest } from "./trending.sandbox";

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
		getUserPreferences: () => Effect.succeed({ allowNsfw: false, disableIntegrations: false }),
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
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
			["movie.tmdb.search", "search", ["httpCall", "getPluginConfig", "getUserPreferences"]],
			["movie.tmdb.details", "details", ["httpCall", "getPluginConfig"]],
			["movie.tmdb.resolve", "resolve", ["httpCall", "getPluginConfig"]],
			["movie.tmdb.translate", "translate", ["httpCall", "getPluginConfig"]],
		]);
	});
	it("declares trending as a generic provider-associated script", () => {
		expect({
			kind: trendingManifest.kind,
			slug: trendingManifest.slug,
			capabilities: trendingManifest.capabilities,
			operation: "operation" in trending ? trending.operation : null,
			requiredPluginConfigKeys: trendingManifest.requiredPluginConfigKeys,
		}).toEqual({
			kind: "script",
			operation: null,
			slug: "movie.tmdb.trending",
			capabilities: ["httpCall", "getPluginConfig"],
			requiredPluginConfigKeys: ["tmdbAccessToken"],
		});
	});
	it("keeps TMDB recommendations as related entities", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/movie/1/recommendations")) {
				return httpSuccess({
					results: [
						{ id: 2, name: "Pick One", title: "Pick One" },
						{ id: 3, name: "Pick Two", title: "Pick Two" },
					],
				});
			}
			if (url.includes("/movie/1/credits")) {
				return httpSuccess({ cast: [], crew: [] });
			}
			if (url.includes("/movie/1/images")) {
				return httpSuccess({
					posters: [{ file_path: "/poster-alt.jpg" }, { file_path: "/shared.jpg" }],
					backdrops: [{ file_path: "/shared.jpg" }, { file_path: "/backdrop-alt.jpg" }],
				});
			}
			return httpSuccess({
				id: 1,
				genres: [],
				adult: false,
				runtime: 120,
				overview: null,
				title: "Source",
				vote_average: 7.5,
				status: "Released",
				production_companies: [],
				poster_path: "/poster.jpg",
				release_date: "2024-01-01",
				belongs_to_collection: null,
				backdrop_path: "/backdrop.jpg",
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({
						images: [
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster.jpg",
							},
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster-alt.jpg",
							},
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/shared.jpg",
							},
							{
								type: "remote",
								purpose: "backdrop",
								url: "https://image.tmdb.org/t/p/original/backdrop.jpg",
							},
							{
								type: "remote",
								purpose: "backdrop",
								url: "https://image.tmdb.org/t/p/original/backdrop-alt.jpg",
							},
						],
					});
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
								{ externalId: "2", name: "Pick One", providerSlug: "movie.tmdb" },
								{ externalId: "3", name: "Pick Two", providerSlug: "movie.tmdb" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("classifies localized movie posters as covers", () => {
		const host = makeHost((_method, url) =>
			url.includes("/movie/1/translations")
				? httpSuccess({
						translations: [{ iso_639_1: "fr", iso_3166_1: "FR", data: { title: "Film" } }],
					})
				: httpSuccess({ posters: [{ iso_639_1: "fr", file_path: "/poster-fr.jpg" }] }),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ externalId: "1", language: "fr-FR", entitySchemaSlug: "movie" },
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.properties).toEqual({
						images: [
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster-fr.jpg",
							},
						],
					});
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
							{ externalId: "1", name: "First Movie" },
							{ externalId: "2", name: "Second Movie" },
							{ externalId: "4", name: "Third Movie" },
							{ externalId: "5", name: "Fourth Movie" },
						],
					});
					return undefined;
				}),
			),
		);
	});
});
