import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";
import translate, { manifest as translateManifest } from "./translate.sandbox";

type TvdbHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: TvdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getCachedValue: () => Effect.succeed("Bearer test-token"),
		setCachedValue: () => Effect.succeed(null),
		getPluginConfig: (keys) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "test-api-key"]))),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("show.tvdb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[translateManifest.slug, translate.operation],
		]).toEqual([
			["show.tvdb.search", "search"],
			["show.tvdb.details", "details"],
			["show.tvdb.translate", "translate"],
		]);
	});
	it("fetches and caches a token before searching on a cache miss", () => {
		const cacheWrites: Array<readonly [string, unknown, number]> = [];
		const host = defineSandboxTestHost(manifest, {
			getCachedValue: () => Effect.succeed(null),
			getPluginConfig: (keys) => {
				expect(keys).toEqual(["tvdbApiKey"]);
				return Effect.succeed({ tvdbApiKey: "test-api-key" });
			},
			setCachedValue: (key, value, ttl) => {
				cacheWrites.push([key, value, ttl]);
				return Effect.succeed(null);
			},
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				expect(requestUrl.host).toBe("api4.thetvdb.com");
				if (requestUrl.pathname === "/v4/login") {
					return httpSuccess({ status: "success", data: { token: "test-token" } });
				}
				expect(requestUrl.pathname).toBe("/v4/search");
				return httpSuccess({ status: "success", links: { next: null }, data: [] });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "show", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(cacheWrites).toEqual([["tvdb_access_token", "Bearer test-token", 82_800]]);
					expect(result.items).toEqual([]);
					return undefined;
				}),
			),
		);
	});
	it("dedupes seasons by number, keeps only official ones sorted by number", () => {
		const requested: string[] = [];
		const host = makeHost((_method, url) => {
			const { pathname } = new URL(url);
			requested.push(pathname);
			if (pathname.endsWith("/series/1/extended")) {
				return httpSuccess({
					data: {
						slug: "my-show",
						name: "My Show",
						image: "show.jpg",
						artworks: [{ image: "show-art.jpg" }],
						status: { id: 2, name: "Ended", recordType: "series" },
						seasons: [
							{ id: 101, number: 1 },
							{ id: 999, number: 1 },
							{ id: 102, number: 2 },
							{ id: 103, number: 3 },
							{ id: 100, number: 0 },
						],
					},
				});
			}
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: {} });
			}
			if (pathname.endsWith("/seasons/101/extended")) {
				return httpSuccess({
					data: {
						id: 101,
						number: 1,
						year: "2020",
						image: "s1.jpg",
						type: { type: "official" },
						episodes: [
							{
								id: 11,
								number: 1,
								runtime: 42,
								name: "Pilot",
								aired: "2020-01-01",
								image: "e1.jpg",
								overview: "ov",
							},
							{ id: 12, number: 2 },
						],
					},
				});
			}
			if (pathname.endsWith("/seasons/102/extended")) {
				return httpSuccess({
					data: {
						id: 102,
						number: 2,
						type: { type: "official" },
						episodes: [{ id: 21, number: 1, name: "S2E1" }],
					},
				});
			}
			if (pathname.endsWith("/seasons/103/extended")) {
				return httpSuccess({
					data: { id: 103, number: 3, type: { type: "official" }, episodes: [] },
				});
			}
			if (pathname.endsWith("/seasons/100/extended")) {
				return httpSuccess({ data: { id: 100, number: 0, type: { type: "alternate" } } });
			}
			return httpSuccess({ data: {} });
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(requested).toEqual(
						expect.arrayContaining([
							"/v4/seasons/101/extended",
							"/v4/seasons/102/extended",
							"/v4/seasons/103/extended",
							"/v4/seasons/100/extended",
						]),
					);
					expect(requested).not.toContain("/v4/seasons/999/extended");
					expect(result.childEntities).toEqual([
						{
							childEntities: [
								{
									name: "Pilot",
									externalId: "11",
									entitySchemaSlug: "show-episode",
									properties: {
										runtime: 42,
										seasonNumber: 1,
										description: "ov",
										episodeNumber: 1,
										parentShowExternalId: "1",
										publishDate: "2020-01-01",
										images: [{ type: "remote", url: "e1.jpg", purpose: "still" }],
									},
								},
								{
									name: "Episode 2",
									externalId: "12",
									entitySchemaSlug: "show-episode",
									properties: {
										runtime: null,
										seasonNumber: 1,
										description: null,
										episodeNumber: 2,
										publishDate: null,
										parentShowExternalId: "1",
									},
								},
							],
							externalId: "101",
							name: "Season 1",
							entitySchemaSlug: "show-season",
							expectedChildEntitySchemaSlug: "show-episode",
							properties: {
								seasonNumber: 1,
								releaseDate: "2020-01-01",
								parentShowExternalId: "1",
								images: [{ type: "remote", url: "s1.jpg", purpose: "cover" }],
							},
						},
						{
							childEntities: [
								{
									name: "S2E1",
									externalId: "21",
									entitySchemaSlug: "show-episode",
									properties: {
										runtime: null,
										seasonNumber: 2,
										description: null,
										episodeNumber: 1,
										publishDate: null,
										parentShowExternalId: "1",
									},
								},
							],
							externalId: "102",
							name: "Season 2",
							entitySchemaSlug: "show-season",
							expectedChildEntitySchemaSlug: "show-episode",
							properties: { seasonNumber: 2, releaseDate: null, parentShowExternalId: "1" },
						},
						{
							childEntities: [],
							externalId: "103",
							name: "Season 3",
							entitySchemaSlug: "show-season",
							expectedChildEntitySchemaSlug: "show-episode",
							properties: { seasonNumber: 3, releaseDate: null, parentShowExternalId: "1" },
						},
					]);
					expect(result.properties).toEqual({
						genres: [],
						images: [
							{ type: "remote", url: "show.jpg", purpose: "cover" },
							{ type: "remote", url: "show-art.jpg", purpose: "artwork" },
						],
						totalSeasons: 3,
						totalEpisodes: 3,
						publishYear: null,
						description: null,
						unlinkedCreators: [],
						productionStatus: "Ended",
						sourceUrl: "https://thetvdb.com/series/my-show",
					});
					return undefined;
				}),
			),
		);
	});
	it("applies translation overrides, year fallback, numeric sourceUrl, merged relations", () => {
		const host = makeHost((_method, url) => {
			const { pathname } = new URL(url);
			if (pathname.endsWith("/companies/types")) {
				return httpSuccess({
					data: [
						{ companyTypeId: 1, companyTypeName: "Studio" },
						{ companyTypeId: 2, companyTypeName: "Network" },
					],
				});
			}
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: { name: "Localized Name", overview: "Localized Desc" } });
			}
			return httpSuccess({
				data: {
					seasons: [],
					year: "not-a-year",
					name: "Canonical Name",
					firstAired: "2015-06-01",
					characters: [
						{ peopleId: 5, personName: "Alice", peopleType: "Actor" },
						{ peopleId: 5, personName: "Alice", peopleType: "Director" },
						{ personName: "Bob", peopleType: "Writer" },
					],
					companies: [
						{ id: 7, name: "Studio X", primaryCompanyType: 1 },
						{ id: 7, name: "Studio X", primaryCompanyType: 2 },
						{ id: 8, name: "Company Y", primaryCompanyType: 99 },
						{ name: "Missing ID", primaryCompanyType: 1 },
					],
				},
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "123" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Localized Name");
					expect(result.childEntities).toEqual([]);
					expect(result.expectedChildEntitySchemaSlug).toBe("show-season");
					expect(result.properties).toEqual({
						genres: [],
						images: [],
						totalSeasons: 0,
						totalEpisodes: 0,
						publishYear: 2015,
						productionStatus: null,
						description: "Localized Desc",
						sourceUrl: "https://thetvdb.com/series/123",
						unlinkedCreators: [{ name: "Bob", role: "Writer" }],
					});
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-show",
							entities: [
								{
									name: "Alice",
									externalId: "5",
									providerSlug: "person.tvdb",
									relationshipProperties: { roles: ["Actor", "Director"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-show",
							entities: [
								{
									externalId: "7",
									name: "Studio X",
									providerSlug: "company.tvdb",
									relationshipProperties: { roles: ["Studio", "Network"] },
								},
								{
									externalId: "8",
									name: "Company Y",
									providerSlug: "company.tvdb",
									relationshipProperties: { roles: ["Company"] },
								},
							],
						},
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("derives season and episode translation paths from the parent show id", () => {
		const requested: Array<{ method: string; path: string }> = [];
		const host = makeHost((method, url) => {
			const { pathname } = new URL(url);
			requested.push({ method, path: pathname });
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: { name: "Localized", overview: "Localized Desc" } });
			}
			return httpSuccess({
				data: {
					artworks: [
						{ language: "eng", image: "art.jpg" },
						{ language: "fra", image: "x" },
					],
				},
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{
					language: "en",
					externalId: "555",
					entitySchemaSlug: "show-season",
					properties: { parentShowExternalId: "10" },
				},
				host,
				execution,
			)
				.pipe(
					Effect.flatMap((seasonResult) => {
						expect(requested).toContainEqual({ method: "GET", path: "/v4/seasons/555/extended" });
						expect(requested).toContainEqual({
							method: "GET",
							path: "/v4/seasons/555/translations/eng",
						});
						expect(seasonResult).toEqual({
							name: "Localized",
							properties: {
								description: "Localized Desc",
								images: [{ type: "remote", url: "art.jpg", purpose: "cover" }],
							},
						});
						return runSandboxTestScript(
							translate,
							{
								language: "en",
								externalId: "777",
								entitySchemaSlug: "show-episode",
								properties: { parentShowExternalId: "10" },
							},
							host,
							execution,
						);
					}),
				)
				.pipe(
					Effect.map((episodeResult) => {
						expect(requested).toContainEqual({ method: "GET", path: "/v4/episodes/777/extended" });
						expect(requested).toContainEqual({
							method: "GET",
							path: "/v4/episodes/777/translations/eng",
						});
						expect(episodeResult).toEqual({
							name: "Localized",
							properties: {
								description: "Localized Desc",
								images: [{ type: "remote", url: "art.jpg", purpose: "still" }],
							},
						});
						return undefined;
					}),
				),
		);
	});
	it("rejects an unsupported translation entity schema", () => {
		const host = makeHost(() => httpSuccess({ data: {} }));
		return expect(
			Effect.runPromise(
				runSandboxTestScript(
					translate,
					{
						language: "en",
						externalId: "1",
						entitySchemaSlug: "person",
						properties: { parentShowExternalId: "10" },
					},
					host,
					execution,
				),
			),
		).rejects.toThrow("show.tvdb translate supports only show, show-season, and show-episode");
	});
	it("maps search results with name-to-title fallback and pagination", () => {
		const host = makeHost(() =>
			httpSuccess({
				links: { next: "https://api4.thetvdb.com/v4/search?offset=20" },
				data: [
					{ tvdb_id: "42", name: "Found Show", poster: "p.jpg" },
					{ tvdb_id: "43", title: "Title Only" },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "test", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{ externalId: "42", imageUrl: "p.jpg", title: "Found Show" },
						{ externalId: "43", title: "Title Only" },
					]);
					expect(result.details).toEqual({ totalItems: 2, nextPage: 2 });
					return undefined;
				}),
			),
		);
	});
});
