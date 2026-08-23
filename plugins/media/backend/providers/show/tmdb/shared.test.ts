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
describe("show.tmdb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
			[resolveManifest.slug, resolve.operation, resolveManifest.capabilities],
			[translateManifest.slug, translate.operation, translateManifest.capabilities],
		]).toEqual([
			["show.tmdb.search", "search", ["httpCall", "getPluginConfig", "getUserPreferences"]],
			["show.tmdb.details", "details", ["httpCall", "getPluginConfig"]],
			["show.tmdb.resolve", "resolve", ["httpCall", "getPluginConfig"]],
			["show.tmdb.translate", "translate", ["httpCall", "getPluginConfig"]],
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
			slug: "show.tmdb.trending",
			capabilities: ["httpCall", "getPluginConfig"],
			requiredPluginConfigKeys: ["tmdbAccessToken"],
		});
	});
	it("builds the TMDB show search endpoint", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			expect(requestUrl.host).toBe("api.themoviedb.org");
			expect(requestUrl.pathname).toBe("/3/search/tv");
			return httpSuccess({ page: 1, results: [], total_results: 0 });
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "show" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ items: [], details: { totalItems: 0, nextPage: null } });
					return undefined;
				}),
			),
		);
	});
	it("keeps TMDB recommendations as related entities", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/tv/1/recommendations")) {
				return httpSuccess({
					results: [
						{ id: 2, name: "Pick One", title: "Pick One" },
						{ id: 3, name: "Pick Two", title: "Pick Two" },
					],
				});
			}
			if (url.includes("/tv/1/credits")) {
				return httpSuccess({ cast: [], crew: [] });
			}
			if (url.includes("/tv/1/watch/providers")) {
				return httpSuccess({ results: {} });
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
					expect(result.childEntities).toEqual([]);
					expect(result.properties).toMatchObject({ productionStatus: "Ended" });
					expect(result.expectedChildEntitySchemaSlug).toBe("show-season");
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
								{ externalId: "2", name: "Pick One", providerSlug: "show.tmdb" },
								{ externalId: "3", name: "Pick Two", providerSlug: "show.tmdb" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("classifies show, season, and episode images", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/tv/1/recommendations")) {
				return httpSuccess({ results: [] });
			}
			if (url.includes("/tv/1/credits")) {
				return httpSuccess({ cast: [], crew: [] });
			}
			if (url.includes("/tv/1/watch/providers")) {
				return httpSuccess({ results: {} });
			}
			if (url.includes("/tv/1/images")) {
				return httpSuccess({ posters: [], backdrops: [] });
			}
			if (url.includes("/tv/1/season/1")) {
				return httpSuccess({
					id: 101,
					name: "Season 1",
					season_number: 1,
					poster_path: "/season.jpg",
					episodes: [{ id: 11, name: "Pilot", episode_number: 1, still_path: "/still.jpg" }],
				});
			}
			return httpSuccess({
				id: 1,
				genres: [],
				networks: [],
				name: "Source",
				created_by: [],
				poster_path: "/show.jpg",
				production_companies: [],
				seasons: [{ season_number: 1 }],
				backdrop_path: "/show-backdrop.jpg",
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						properties: {
							images: [
								{
									type: "remote",
									purpose: "cover",
									url: "https://image.tmdb.org/t/p/original/show.jpg",
								},
								{
									type: "remote",
									purpose: "backdrop",
									url: "https://image.tmdb.org/t/p/original/show-backdrop.jpg",
								},
							],
						},
					});
					expect(result.childEntities).toMatchObject([
						{
							properties: {
								images: [
									{
										type: "remote",
										purpose: "cover",
										url: "https://image.tmdb.org/t/p/original/season.jpg",
									},
								],
							},
							childEntities: [
								{
									properties: {
										images: [
											{
												type: "remote",
												purpose: "still",
												url: "https://image.tmdb.org/t/p/original/still.jpg",
											},
										],
									},
								},
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("keeps the offer kinds TMDB reports for a show", () => {
		const host = makeHost((_method, url) => {
			if (url.includes("/tv/1/watch/providers")) {
				return httpSuccess({
					results: {
						GB: {
							ads: [{ provider_name: "Tubi", logo_path: "/tubi.jpg" }],
							free: [{ provider_name: "Tubi", logo_path: "/tubi.jpg" }],
						},
					},
				});
			}
			if (url.includes("/tv/1/recommendations")) {
				return httpSuccess({ results: [] });
			}
			if (url.includes("/tv/1/credits")) {
				return httpSuccess({ cast: [], crew: [] });
			}
			if (url.includes("/tv/1/images")) {
				return httpSuccess({ posters: [], backdrops: [] });
			}
			return httpSuccess({ id: 1, seasons: [], name: "Source" });
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({
						watchProviders: [
							{
								name: "Tubi",
								image: "https://image.tmdb.org/t/p/original/tubi.jpg",
								availability: [{ country: "GB", offers: ["free", "ads"] }],
							},
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("classifies localized show posters and episode stills", () => {
		const host = makeHost((_method, url) =>
			url.includes("/translations")
				? httpSuccess({ translations: [{ iso_639_1: "fr", data: { name: "Série" } }] })
				: httpSuccess({
						stills: [{ iso_639_1: "fr", file_path: "/still-fr.jpg" }],
						posters: [{ iso_639_1: "fr", file_path: "/poster-fr.jpg" }],
					}),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{ language: "fr", externalId: "1", entitySchemaSlug: "show" },
				host,
				execution,
			).pipe(
				Effect.flatMap((showResult) => {
					expect(showResult.properties).toEqual({
						images: [
							{
								type: "remote",
								purpose: "cover",
								url: "https://image.tmdb.org/t/p/original/poster-fr.jpg",
							},
						],
					});
					return runSandboxTestScript(
						translate,
						{
							language: "fr",
							externalId: "2",
							entitySchemaSlug: "show-episode",
							properties: { seasonNumber: 1, episodeNumber: 2, parentShowExternalId: "1" },
						},
						host,
						execution,
					);
				}),
				Effect.map((episodeResult) => {
					expect(episodeResult.properties).toEqual({
						images: [
							{
								type: "remote",
								purpose: "still",
								url: "https://image.tmdb.org/t/p/original/still-fr.jpg",
							},
						],
					});
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
							{ externalId: "10", name: "First Show" },
							{ externalId: "20", name: "Second Show" },
							{ externalId: "40", name: "Third Show" },
							{ externalId: "50", name: "Fourth Show" },
						],
					});
					return undefined;
				}),
			),
		);
	});
});
