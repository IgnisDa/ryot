import { describe, expect, it } from "bun:test";

import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import details, { manifest as detailsManifest } from "./details.sandbox";
import related, { manifest as relatedManifest } from "./related.sandbox";
import resolve, { manifest as resolveManifest } from "./resolve.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";
import translate, { manifest as translateManifest } from "./translate.sandbox";
import trending, { manifest as trendingManifest } from "./trending.sandbox";

type TmdbHost = Pick<ScriptHost, "httpCall" | "getPluginConfig" | "getUserSettings">;
const httpSuccess = (body: unknown) =>
	Effect.succeed({
		status: 200,
		headers: {},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
const makeHost = (httpCall: TmdbHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getUserSettings: () => Effect.succeed({ allowNsfw: false }),
		getPluginConfig: ({ required: keys = [] }) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
	});
type TvFixtures = {
	images?: unknown;
	show: Record<string, unknown>;
	appended?: Record<string, unknown>;
	other?: (pathname: string) => unknown;
};
const makeTvHost = (id: string, fixtures: TvFixtures, requests: URL[] = []) =>
	makeHost((_method, url) => {
		const requestUrl = new URL(url);
		requests.push(requestUrl);
		if (requestUrl.pathname === `/3/tv/${id}`) {
			const keys = (requestUrl.searchParams.get("append_to_response") ?? "").split(",");
			return httpSuccess({
				...fixtures.show,
				...Object.fromEntries(
					keys.flatMap((key) =>
						fixtures.appended && key in fixtures.appended ? [[key, fixtures.appended[key]]] : [],
					),
				),
			});
		}
		if (requestUrl.pathname === `/3/tv/${id}/images`) {
			return httpSuccess(fixtures.images ?? { posters: [], backdrops: [] });
		}
		return httpSuccess(fixtures.other?.(requestUrl.pathname) ?? {});
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
const image = (purpose: string, path: string) => ({
	purpose,
	type: "remote",
	url: `https://image.tmdb.org/t/p/original${path}`,
});

describe("show.tmdb sandbox script", () => {
	it("declares a script for each operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[relatedManifest.slug, related.operation],
			[resolveManifest.slug, resolve.operation],
			[translateManifest.slug, translate.operation],
		]).toEqual([
			["show.tmdb.search", "search"],
			["show.tmdb.details", "details"],
			["show.tmdb.related", "related"],
			["show.tmdb.resolve", "resolve"],
			["show.tmdb.translate", "translate"],
		]);
	});

	it("declares trending as a generic provider-associated script", () => {
		expect({
			kind: trendingManifest.kind,
			slug: trendingManifest.slug,
			operation: "operation" in trending ? trending.operation : null,
		}).toEqual({ kind: "script", operation: null, slug: "show.tmdb.trending" });
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
		const host = makeTvHost("1", {
			appended: {
				credits: { cast: [], crew: [] },
				"watch/providers": { results: {} },
				aggregate_credits: { cast: [], crew: [] },
				recommendations: {
					results: [
						{ id: 2, name: "Pick One", title: "Pick One" },
						{ id: 3, name: "Pick Two", title: "Pick Two" },
					],
				},
			},
			show: {
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
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.childEntities).toEqual([]);
					expect(result.properties).toMatchObject({ episodeOrders: [], productionStatus: "Ended" });
					expect(result.expectedChildEntitySchemaSlug).toBe("show-season");
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "person-to-show",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "company-to-show",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ externalId: "2", name: "Pick One", providerSlug: "show.tmdb" },
								{ externalId: "3", name: "Pick Two", providerSlug: "show.tmdb" },
							],
						},
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "show-to-genre",
						},
					]);
					return undefined;
				}),
			),
		);
	});

	it.each([
		{
			appended: {},
			label: "missing inventories",
			show: { id: 1, seasons: [], name: "Source" },
			companyCoverage: {
				status: "source-limited",
				reason: "TMDB show companies inventory was missing or malformed",
			},
			peopleCoverage: {
				status: "source-limited",
				reason: "TMDB show aggregate credits did not include cast and crew arrays",
			},
		},
		{
			label: "explicit empty inventories",
			peopleCoverage: { status: "complete" },
			companyCoverage: { status: "complete" },
			appended: { aggregate_credits: { cast: [], crew: [] } },
			show: { id: 1, seasons: [], networks: [], name: "Source", production_companies: [] },
		},
	])(
		"reports full show credit coverage for $label",
		({ show, appended, peopleCoverage, companyCoverage }) => {
			const host = makeTvHost("1", { show, appended });
			return Effect.runPromise(
				runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
					Effect.map((result) => {
						const groups = result.relatedEntityGroups ?? [];
						expect(
							groups.find(
								({ relationshipSchemaSlug }) => relationshipSchemaSlug === "person-to-show",
							),
						).toMatchObject({
							entities: [],
							direction: "incoming",
							coverage: peopleCoverage,
							synchronization: "authoritative",
						});
						expect(
							groups.find(
								({ relationshipSchemaSlug }) => relationshipSchemaSlug === "company-to-show",
							),
						).toMatchObject({
							entities: [],
							direction: "incoming",
							coverage: companyCoverage,
							synchronization: "authoritative",
						});
						return undefined;
					}),
				),
			);
		},
	);

	it("appends only watch providers and episode groups to the show request at base level", () => {
		const requests: URL[] = [];
		const host = makeTvHost(
			"1",
			{
				show: { id: 1, seasons: [], name: "Source" },
				appended: {
					credits: { crew: [], cast: [{ id: 5, name: "Actor" }] },
					recommendations: { results: [{ id: 2, name: "Pick" }] },
				},
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { level: "base", externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						requests.map(({ pathname, searchParams }) => [
							pathname,
							searchParams.get("append_to_response"),
							searchParams.get("language"),
						]),
					).toEqual([
						["/3/tv/1", "watch/providers,episode_groups", "en"],
						["/3/tv/1/images", null, null],
					]);
					expect(
						result.relatedEntityGroups?.map(({ relationshipSchemaSlug }) => relationshipSchemaSlug),
					).toEqual([]);
					return undefined;
				}),
			),
		);
	});

	it("appends aggregate credits, credits, and recommendations only at full level", () => {
		const requests: URL[] = [];
		const host = makeTvHost("1", { show: { id: 1, seasons: [], name: "Source" } }, requests);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.flatMap(() =>
					runSandboxTestScript(details, { level: "full", externalId: "1" }, host, execution),
				),
				Effect.map(() => {
					expect(
						requests.map(({ searchParams }) => searchParams.get("append_to_response")),
					).toEqual([
						"watch/providers,episode_groups,credits,aggregate_credits,recommendations",
						null,
						"watch/providers,episode_groups,credits,aggregate_credits,recommendations",
						null,
					]);
					return undefined;
				}),
			),
		);
	});

	it("fetches seasons through show appends in chunks of at most twenty", () => {
		const requests: URL[] = [];
		const host = makeTvHost(
			"1",
			{
				show: {
					id: 1,
					name: "Long Runner",
					seasons: Array.from({ length: 25 }, (_, index) => ({
						id: 100 + index,
						season_number: index,
					})),
				},
				appended: Object.fromEntries(
					Array.from({ length: 25 }, (_, index) => [
						`season/${index}`,
						{ episodes: [], season_number: index, name: `Season ${index}` },
					]),
				),
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { level: "base", externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					const seasonRequests = requests.filter(({ searchParams }) =>
						searchParams.get("append_to_response")?.startsWith("season/"),
					);
					expect(
						seasonRequests.map(({ searchParams }) =>
							searchParams.get("append_to_response")?.split(","),
						),
					).toEqual([
						Array.from({ length: 20 }, (_, index) => `season/${index}`),
						Array.from({ length: 5 }, (_, index) => `season/${index + 20}`),
					]);
					expect(result.childEntities?.map(({ name, externalId }) => [name, externalId])).toEqual(
						Array.from({ length: 25 }, (_, index) => [`Season ${index}`, String(100 + index)]),
					);
					return undefined;
				}),
			),
		);
	});

	it("fails when a requested season is absent from the appended response", () => {
		const host = makeTvHost("1", {
			appended: { "season/1": { episodes: [] } },
			show: {
				id: 1,
				name: "Source",
				seasons: [
					{ id: 101, season_number: 1 },
					{ id: 102, season_number: 2 },
				],
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toBe("TMDB returned no object for season 2");
					return undefined;
				}),
			),
		);
	});

	it("fails when a requested season has no episodes array", () => {
		const host = makeTvHost("1", {
			appended: { "season/1": { episodes: null } },
			show: { id: 1, name: "Source", seasons: [{ id: 101, season_number: 1 }] },
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toBe("TMDB returned no episodes array for season 1");
					return undefined;
				}),
			),
		);
	});

	it("accepts explicit empty episode arrays for every listed season", () => {
		const host = makeTvHost("1", {
			appended: { "season/1": { episodes: [] }, "season/2": { episodes: [] } },
			show: {
				id: 1,
				name: "Source",
				seasons: [
					{ id: 101, season_number: 1 },
					{ id: 102, season_number: 2 },
				],
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						result.childEntities?.map(({ externalId, childEntities }) => [
							externalId,
							childEntities,
						]),
					).toEqual([
						["101", []],
						["102", []],
					]);
					return undefined;
				}),
			),
		);
	});

	it("requests show images without a language and keeps every localized and unlocalized image", () => {
		const requests: URL[] = [];
		const host = makeTvHost(
			"1",
			{
				show: {
					id: 1,
					seasons: [],
					name: "Source",
					poster_path: "/poster-main.jpg",
					backdrop_path: "/backdrop-main.jpg",
				},
				images: {
					backdrops: [
						{ iso_639_1: null, file_path: "/backdrop-none.jpg" },
						{ iso_639_1: "de", file_path: "/backdrop-de.jpg" },
					],
					posters: [
						{ iso_639_1: "fr", file_path: "/poster-fr.jpg" },
						{ iso_639_1: null, file_path: "/poster-none.jpg" },
						{ iso_639_1: "en", file_path: "/poster-main.jpg" },
					],
				},
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { level: "base", externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					const imagesRequest = requests.find(({ pathname }) => pathname.endsWith("/images"));
					expect(imagesRequest?.search).toBe("");
					expect(result.properties).toMatchObject({
						images: [
							image("cover", "/poster-main.jpg"),
							image("cover", "/poster-fr.jpg"),
							image("cover", "/poster-none.jpg"),
							image("backdrop", "/backdrop-main.jpg"),
							image("backdrop", "/backdrop-none.jpg"),
							image("backdrop", "/backdrop-de.jpg"),
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("classifies show, season, and episode images", () => {
		const host = makeTvHost("1", {
			appended: {
				"season/1": {
					name: "Season 1",
					season_number: 1,
					poster_path: "/season.jpg",
					episodes: [{ id: 11, name: "Pilot", episode_number: 1, still_path: "/still.jpg" }],
				},
			},
			show: {
				id: 1,
				genres: [],
				networks: [],
				name: "Source",
				created_by: [],
				poster_path: "/show.jpg",
				production_companies: [],
				backdrop_path: "/show-backdrop.jpg",
				seasons: [{ id: 101, season_number: 1 }],
			},
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

	it("keeps the offer kinds and the country link TMDB reports for a show", () => {
		const host = makeTvHost("1", {
			show: { id: 1, seasons: [], name: "Source" },
			appended: {
				"watch/providers": {
					results: {
						GB: {
							link: "https://www.themoviedb.org/tv/1/watch?locale=GB",
							ads: [{ provider_name: "Tubi", logo_path: "/tubi.jpg" }],
							free: [{ provider_name: "Tubi", logo_path: "/tubi.jpg" }],
						},
					},
				},
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({
						watchProviders: [
							{
								country: "GB",
								link: "https://www.themoviedb.org/tv/1/watch?locale=GB",
								providers: [
									{
										name: "Tubi",
										offers: ["free", "ads"],
										image: "https://image.tmdb.org/t/p/original/tubi.jpg",
									},
								],
							},
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("stores TMDB episode groups as episode orders of episode ids in group order", () => {
		const requests: URL[] = [];
		const host = makeTvHost(
			"1437",
			{
				show: { id: 1437, seasons: [], name: "Firefly" },
				appended: {
					episode_groups: {
						id: 1437,
						results: [
							{
								type: 6,
								name: "Production Order",
								id: "5acfb4960e0a26346d0046d2",
								description: "The proper and intended order of Firefly episodes.",
							},
							{ type: 9, id: "unknown-kind", name: "Unknown Kind" },
							{ type: 3, name: "", id: "unnamed" },
							{ type: 3, id: "dvd-order", description: "", name: "DVD Order" },
						],
					},
				},
				other: (pathname) =>
					pathname === "/3/tv/episode_group/5acfb4960e0a26346d0046d2"
						? {
								groups: [
									{
										order: 2,
										name: "Movie",
										episodes: [{ order: 0, id: 1048600, season_number: 0, episode_number: 1 }],
									},
									{
										order: 1,
										name: "Season 1",
										episodes: [
											{ order: 1, id: 1048594, season_number: 1, episode_number: 1 },
											{ order: 0, id: 1048593, season_number: 1, episode_number: 11 },
											{ id: 0, order: 2 },
											{ order: 3, id: "1048595" },
										],
									},
								],
							}
						: { groups: [] },
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1437" }, host, execution).pipe(
				Effect.map((result) => {
					expect(
						requests
							.map(({ pathname }) => pathname)
							.filter((path) => path.includes("/episode_group/")),
					).toEqual([
						"/3/tv/episode_group/5acfb4960e0a26346d0046d2",
						"/3/tv/episode_group/dvd-order",
					]);
					expect(result.properties).toMatchObject({
						episodeOrders: [
							{
								type: "production",
								name: "Production Order",
								externalId: "5acfb4960e0a26346d0046d2",
								description: "The proper and intended order of Firefly episodes\\.",
								groups: [
									{ order: 1, name: "Season 1", episodeExternalIds: ["1048593", "1048594"] },
									{ order: 2, name: "Movie", episodeExternalIds: ["1048600"] },
								],
							},
							{
								groups: [],
								type: "dvd",
								name: "DVD Order",
								description: null,
								externalId: "dvd-order",
							},
						],
					});
					return undefined;
				}),
			),
		);
	});

	it("fetches every listed episode order without silently applying a local HTTP budget", () => {
		const requests: URL[] = [];
		const host = makeTvHost(
			"456",
			{
				other: () => ({ groups: [] }),
				show: { seasons: [], name: "Order source" },
				appended: {
					episode_groups: {
						results: Array.from({ length: 60 }, (_, index) => ({
							type: 3,
							id: `order-${index}`,
							name: `order-${index}`,
						})),
					},
				},
			},
			requests,
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "456" }, host, execution).pipe(
				Effect.map((result) => {
					expect(requests).toHaveLength(62);
					expect(result.properties).toMatchObject({
						episodeOrders: Array.from({ length: 60 }, (_, index) => ({
							externalId: `order-${index}`,
						})),
					});
					return undefined;
				}),
			),
		);
	});

	it("uses aggregate credits for all jobs and classifies guests from episode guest-star lists", () => {
		const host = makeTvHost("1", {
			show: {
				id: 1,
				networks: [],
				name: "Series",
				production_companies: [],
				seasons: [{ id: 101, season_number: 1 }],
				created_by: [{ id: 13, name: "Creator" }],
			},
			appended: {
				credits: { crew: [], cast: [{ id: 11, name: "Regular" }] },
				"season/1": {
					season_number: 1,
					episodes: [
						{
							id: 1011,
							episode_number: 1,
							guest_stars: [{ id: 9 }, { id: 10 }, { id: 10 }, { id: 11 }],
						},
						{ id: 1012, episode_number: 2, guest_stars: [{ id: 10 }, { id: 11 }] },
						{ id: 1013, episode_number: 3, guest_stars: [{ id: 11 }] },
					],
				},
				aggregate_credits: {
					crew: [
						{
							id: 12,
							name: "Crew",
							department: "Production",
							jobs: [
								{ episode_count: 3, job: "Executive Producer" },
								{ job: "Producer", episode_count: 3 },
							],
						},
					],
					cast: [
						{
							id: 9,
							order: 4,
							name: "Older Credit",
							total_episode_count: 8,
							known_for_department: "Acting",
							roles: [
								{ episode_count: 7, character: "Older Role" },
								{ episode_count: 1, character: "Second Role" },
							],
						},
						{
							id: 10,
							order: 5,
							name: "Guest",
							total_episode_count: 2,
							known_for_department: "Acting",
							roles: [{ episode_count: 2, character: "Guest Role" }],
						},
						{
							id: 11,
							name: "Regular",
							total_episode_count: 3,
							known_for_department: "Acting",
							roles: [{ episode_count: 3, character: "Regular Role" }],
						},
					],
				},
			},
		});

		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					const group = result.relatedEntityGroups?.find(
						({ relationshipSchemaSlug }) => relationshipSchemaSlug === "person-to-show",
					);
					expect(group).toMatchObject({
						coverage: { status: "complete" },
						synchronization: "authoritative",
					});
					expect(group?.entities.find(({ externalId }) => externalId === "9")).toMatchObject({
						relationshipProperties: {
							order: 4,
							isGuest: false,
							character: "Older Role / Second Role",
						},
					});
					expect(group?.entities.find(({ externalId }) => externalId === "10")).toMatchObject({
						relationshipProperties: { isGuest: true, character: "Guest Role" },
					});
					expect(group?.entities.find(({ externalId }) => externalId === "11")).toMatchObject({
						relationshipProperties: { isGuest: false },
					});
					expect(group?.entities.find(({ externalId }) => externalId === "12")).toMatchObject({
						relationshipProperties: {
							creditKinds: ["crew"],
							departments: ["Production"],
							roles: ["Executive Producer", "Producer"],
						},
					});
					expect(group?.entities.find(({ externalId }) => externalId === "13")).toMatchObject({
						relationshipProperties: { roles: ["Creator"], creditKinds: ["crew"] },
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
				{ name: "Show", language: "fr", properties: {}, externalId: "1", entitySchemaSlug: "show" },
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
							name: "Episode",
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

	const episodeCreditsInput = {
		continuation: null,
		externalId: "62000",
		direction: "incoming" as const,
		entitySchemaSlug: "show-episode",
		relationshipSchemaSlug: "person-to-show-episode",
		properties: { seasonNumber: 9, episodeNumber: 1, parentShowExternalId: "2316" },
	};

	it("credits an episode's cast, guest stars after the cast, and every crew job", () => {
		const requests: URL[] = [];
		const host = makeHost((_method, url) => {
			requests.push(new URL(url));
			return httpSuccess({
				cast: [{ id: 1, order: 0, name: "Regular", character: "Lead" }],
				guest_stars: [
					{ id: 2, order: 1, name: "Visitor", character: "Doctor" },
					{ id: 3, order: 0, name: "Cameo", character: "Self (uncredited)" },
				],
				crew: [
					{ id: 4, job: "Writer", name: "Writer", department: "Writing" },
					{ id: 4, name: "Writer", job: "Director", department: "Directing" },
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(related, episodeCreditsInput, host, execution).pipe(
				Effect.map((result) => {
					expect(requests.map(({ pathname }) => pathname)).toEqual([
						"/3/tv/2316/season/9/episode/1/credits",
					]);
					expect(result).toEqual({
						coverage: { status: "complete" },
						entities: [
							{
								name: "Regular",
								externalId: "1",
								providerSlug: "person.tmdb",
								relationshipProperties: {
									order: 0,
									isGuest: false,
									roles: ["Acting"],
									character: "Lead",
									isUncredited: false,
									creditKinds: ["cast"],
									departments: ["Acting"],
								},
							},
							{
								name: "Visitor",
								externalId: "2",
								providerSlug: "person.tmdb",
								relationshipProperties: {
									order: 2,
									isGuest: true,
									roles: ["Acting"],
									character: "Doctor",
									isUncredited: false,
									creditKinds: ["cast"],
									departments: ["Acting"],
								},
							},
							{
								name: "Cameo",
								externalId: "3",
								providerSlug: "person.tmdb",
								relationshipProperties: {
									order: 1,
									isGuest: true,
									roles: ["Acting"],
									isUncredited: true,
									creditKinds: ["cast"],
									departments: ["Acting"],
									character: "Self (uncredited)",
								},
							},
							{
								name: "Writer",
								externalId: "4",
								providerSlug: "person.tmdb",
								relationshipProperties: {
									creditKinds: ["crew"],
									roles: ["Writer", "Director"],
									departments: ["Writing", "Directing"],
								},
							},
						],
					});
				}),
			),
		);
	});

	it("reports episode credits without cast, guest star, and crew arrays as source-limited", () =>
		Effect.runPromise(
			runSandboxTestScript(
				related,
				episodeCreditsInput,
				makeHost(() => httpSuccess({ cast: [], crew: [] })),
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						entities: [],
						coverage: {
							status: "source-limited",
							reason: "TMDB episode credits did not include cast, guest star, and crew arrays",
						},
					});
				}),
			),
		));

	it("rejects related work other than show episode person credits", () =>
		Effect.runPromise(
			runSandboxTestScript(
				related,
				{ ...episodeCreditsInput, entitySchemaSlug: "show-season" },
				makeHost(() => httpSuccess({})),
				execution,
			).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(error.message).toBe("show.tmdb related supports only show episode person credits");
				}),
			),
		));

	it("upserts TMDB trending shows and returns deduplicated entity ids in fetch order", () => {
		const requestedPages: string[] = [];
		const upserts: Parameters<ScriptHost["upsertGlobalEntities"]>[0][] = [];
		const host = defineSandboxTestHost(manifest, {
			getPluginConfig: ({ required: keys = [] }) =>
				Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
			upsertGlobalEntities: (items) =>
				Effect.sync(() => {
					upserts.push(items);
					return items.map(({ externalId }) =>
						externalId === "40"
							? { status: "skipped" as const }
							: {
									wasInserted: true,
									status: "upserted" as const,
									entityId: externalId === "20" ? "entity-10" : `entity-${externalId}`,
								},
					);
				}),
			httpCall: (_method, url) => {
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
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(trending, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(requestedPages).toEqual(["1", "2", "3"]);
					expect(upserts).toEqual([
						[
							{
								properties: {},
								externalId: "10",
								populatedAt: null,
								name: "First Show",
								entitySchemaSlug: "show",
							},
							{
								properties: {},
								externalId: "20",
								populatedAt: null,
								name: "Second Show",
								entitySchemaSlug: "show",
							},
							{
								properties: {},
								externalId: "40",
								populatedAt: null,
								name: "Third Show",
								entitySchemaSlug: "show",
							},
							{
								properties: {},
								externalId: "50",
								populatedAt: null,
								name: "Fourth Show",
								entitySchemaSlug: "show",
							},
						],
					]);
					expect(result).toEqual({ status: "fetched", entityIds: ["entity-10", "entity-50"] });
					return undefined;
				}),
			),
		);
	});

	it("logs and reports a failed status when the TMDB trending fetch fails", () => {
		const logs: Parameters<ScriptHost["log"]>[0][] = [];
		const host = defineSandboxTestHost(manifest, {
			httpCall: () => Effect.fail({ message: "provider unavailable" }),
			log: (entries) =>
				Effect.sync(() => {
					logs.push(entries);
					return null;
				}),
			getPluginConfig: ({ required: keys = [] }) =>
				Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
		});
		return Effect.runPromise(
			runSandboxTestScript(trending, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ status: "failed" });
					expect(logs).toEqual([
						[
							{
								level: "warning",
								message: "trending provider skipped",
								attributes: { providerSlug: "show.tmdb", error: "provider unavailable" },
							},
						],
					]);
					return undefined;
				}),
			),
		);
	});
});
