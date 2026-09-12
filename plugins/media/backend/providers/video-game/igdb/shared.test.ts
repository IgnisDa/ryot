import { describe, expect, it } from "@effect/vitest";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

import details, { manifest as detailsManifest } from "./details.sandbox";
import searchOptions, { manifest as searchOptionsManifest } from "./search-options.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";

type IgdbVideoGameHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown, headers: Record<string, string> = {}) =>
	Effect.succeed({ headers, status: 200, body: JSON.stringify(body) });
const tokenResponse = () =>
	httpSuccess({ expires_in: 3600, token_type: "bearer", access_token: "token" });
const makeHost = (overrides: Partial<IgdbVideoGameHost>): IgdbVideoGameHost =>
	defineSandboxTestHost(manifest, {
		getCachedValue: () => Effect.succeed(null),
		setCachedValue: () => Effect.succeed(null),
		httpCall: () => Effect.fail({ message: "no route" }),
		getPluginConfig: (keys) =>
			Effect.succeed(
				Object.fromEntries(
					keys.map((key) => [key, key === "twitchClientId" ? "client-id" : "client-secret"]),
				),
			),
		...overrides,
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("video-game.igdb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
			[searchOptionsManifest.slug, searchOptions.operation, searchOptionsManifest.capabilities],
		]).toEqual([
			[
				"video-game.igdb.search",
				"search",
				["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
			],
			[
				"video-game.igdb.details",
				"details",
				["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
			],
			[
				"video-game.igdb.search-options",
				"search-options",
				["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
			],
		]);
	});

	it("loads, normalizes, deduplicates, and sorts search choices", () => {
		const responses: Record<string, unknown> = {
			"/v4/genres": [
				{ id: 4, name: "Strategy" },
				{ id: 3, name: "Action" },
			],
			"/v4/platforms": [
				{ id: 6, name: "Windows" },
				{ id: 5, name: "Linux" },
			],
			"/v4/game_modes": [
				{ id: 8, name: "Single-player" },
				{ id: 7, name: "Co-op" },
			],
			"/v4/game_types": [
				{ id: 10, type: "Expansion" },
				{ id: 9, type: "Main game" },
			],
			"/v4/release_date_regions": [
				{ id: 12, region: "North America" },
				{ id: 11, region: "Europe" },
			],
			"/v4/themes": [
				{ id: 2, name: "Zelda" },
				{ id: 1, name: "Alpha" },
				{ id: 2, name: "Duplicate" },
				{ id: "invalid", name: "Invalid ID" },
				{ id: 3, name: " " },
				null,
			],
		};
		const requestedPaths: Array<string> = [];
		const requestedBodies: Record<string, string> = {};
		let tokenPosts = 0;
		let cachedToken: JsonValue | null = null;
		const host = makeHost({
			getCachedValue: () => Effect.succeed(cachedToken),
			setCachedValue: (_key, value) => {
				cachedToken = value;
				return Effect.succeed(null);
			},
			httpCall: (_method, url, options) => {
				const requestUrl = new URL(url);
				if (requestUrl.host === "id.twitch.tv") {
					tokenPosts += 1;
					return tokenResponse();
				}
				requestedPaths.push(requestUrl.pathname);
				requestedBodies[requestUrl.pathname] =
					typeof options?.body === "string" ? options.body : "";
				return httpSuccess(responses[requestUrl.pathname] ?? []);
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(searchOptions, {}, host, execution).pipe(
				Effect.map((result) => {
					expect([...new Set(requestedPaths)].sort()).toEqual([
						"/v4/game_modes",
						"/v4/game_types",
						"/v4/genres",
						"/v4/platforms",
						"/v4/release_date_regions",
						"/v4/themes",
					]);
					for (const [path, fields] of Object.entries({
						"/v4/themes": "id,name",
						"/v4/genres": "id,name",
						"/v4/platforms": "id,name",
						"/v4/game_modes": "id,name",
						"/v4/game_types": "id,type",
						"/v4/release_date_regions": "id,region",
					})) {
						expect(requestedBodies[path]).toContain(`fields ${fields};`);
						expect(requestedBodies[path]).toContain("sort id asc;\nlimit 500;");
						expect(requestedBodies[path]).toContain("offset 0;");
					}
					expect(tokenPosts).toBe(1);
					expect(result).toEqual({
						sources: {
							themes: [
								{ value: "1", label: "Alpha" },
								{ value: "2", label: "Zelda" },
							],
							genres: [
								{ value: "3", label: "Action" },
								{ value: "4", label: "Strategy" },
							],
							platforms: [
								{ value: "5", label: "Linux" },
								{ value: "6", label: "Windows" },
							],
							gameModes: [
								{ value: "7", label: "Co-op" },
								{ value: "8", label: "Single-player" },
							],
							gameTypes: [
								{ value: "10", label: "Expansion" },
								{ value: "9", label: "Main game" },
							],
							releaseDateRegions: [
								{ value: "11", label: "Europe" },
								{ value: "12", label: "North America" },
							],
						},
					});
					return undefined;
				}),
			),
		);
	});

	it("requests the next search-options page at offset 500", () => {
		const themesOffsets: Array<number> = [];
		const host = makeHost({
			httpCall: (_method, url, options) => {
				const requestUrl = new URL(url);
				if (requestUrl.host === "id.twitch.tv") {
					return tokenResponse();
				}
				const body = typeof options?.body === "string" ? options.body : "";
				if (requestUrl.pathname === "/v4/themes") {
					expect(body).toContain("sort id asc;\nlimit 500;");
					const offset = Number(body.match(/offset (\d+);/)?.[1]);
					themesOffsets.push(offset);
					return httpSuccess(
						offset === 0
							? Array.from({ length: 500 }, (_, index) => ({
									id: index + 1,
									name: `Theme ${index}`,
								}))
							: [{ id: 501, name: "Theme 501" }],
					);
				}
				return httpSuccess([]);
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(searchOptions, {}, host, execution).pipe(
				Effect.map((result) => {
					expect(themesOffsets).toEqual([0, 500]);
					expect(result.sources.themes).toContainEqual({ value: "501", label: "Theme 501" });
					return undefined;
				}),
			),
		);
	});

	it.live("fails when an IGDB search-options response is malformed", () =>
		Effect.gen(function* () {
			const host = makeHost({
				httpCall: (_method, url) => {
					const requestUrl = new URL(url);
					if (requestUrl.host === "id.twitch.tv") {
						return tokenResponse();
					}
					return httpSuccess(requestUrl.pathname === "/v4/themes" ? { invalid: true } : []);
				},
			});

			expect(
				yield* Effect.flip(runSandboxTestScript(searchOptions, {}, host, execution)),
			).toBeDefined();
		}),
	);

	it.live("propagates IGDB search-options request failures", () =>
		Effect.gen(function* () {
			const host = makeHost({
				httpCall: (_method, url) => {
					const requestUrl = new URL(url);
					if (requestUrl.host === "id.twitch.tv") {
						return tokenResponse();
					}
					return requestUrl.pathname === "/v4/themes"
						? Effect.fail({ message: "IGDB unavailable" })
						: httpSuccess([]);
				},
			});

			const error = yield* Effect.flip(runSandboxTestScript(searchOptions, {}, host, execution));
			expect(error).toMatchObject({ message: "IGDB unavailable" });
		}),
	);

	it("maps search hits and paginates using the x-count header", () => {
		const host = makeHost({
			httpCall: (_method, url, options) => {
				const requestUrl = new URL(url);
				if (requestUrl.host === "id.twitch.tv") {
					expect(requestUrl.pathname).toBe("/oauth2/token");
					return tokenResponse();
				}
				expect(requestUrl.host).toBe("api.igdb.com");
				expect(requestUrl.pathname).toBe("/v4/games");
				expect(options?.body).toContain("where version_parent = null;");
				return httpSuccess(
					[
						{
							id: 1,
							name: "First Game",
							cover: { image_id: "abc" },
							first_release_date: 1704067200,
						},
						{ id: 2, name: "" },
					],
					{ "x-count": "5" },
				);
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "game" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "1",
							metadata: [2024],
							title: "First Game",
							imageUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
						},
					]);
					expect(result.details).toEqual({ nextPage: 2, totalItems: 5 });
					return undefined;
				}),
			),
		);
	});

	it("adds all supported metadata filters", () => {
		const host = makeHost({
			httpCall: (_method, url, options) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return tokenResponse();
				}
				expect(options?.body).toContain(
					"where version_parent = null & themes = (1,2) & genres = (3) & platforms = (4) & game_mode = (5) & game_type = (6) & release_dates.region = (7,8);",
				);
				return httpSuccess([], { "x-count": "0" });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{
					page: 1,
					pageSize: 20,
					query: "game",
					options: {
						genreIds: ["3"],
						platformIds: ["4"],
						gameModeIds: ["5"],
						gameTypeIds: ["6"],
						themeIds: ["1", "2"],
						releaseDateRegionIds: ["7", "8"],
					},
				},
				host,
				execution,
			),
		);
	});

	it("allows games with parents", () => {
		const host = makeHost({
			httpCall: (_method, url, options) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return tokenResponse();
				}
				expect(options?.body).not.toContain("where ");
				return httpSuccess([], { "x-count": "0" });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{ page: 1, pageSize: 20, query: "game", options: { allowGamesWithParent: true } },
				host,
				execution,
			),
		);
	});

	it("ignores empty filter arrays", () => {
		const host = makeHost({
			httpCall: (_method, url, options) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return tokenResponse();
				}
				expect(options?.body).toContain("where version_parent = null;");
				expect(options?.body).not.toContain("themes =");
				return httpSuccess([], { "x-count": "0" });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{ page: 1, pageSize: 20, query: "game", options: { themeIds: [] } },
				host,
				execution,
			),
		);
	});

	it.live("rejects invalid search options", () =>
		Effect.gen(function* () {
			const host = makeHost({ httpCall: () => Effect.fail({ message: "unexpected request" }) });
			const invalidOptions: ReadonlyArray<Readonly<Record<string, JsonValue>>> = [
				{ genreIds: [1] },
				{ allowGamesWithParent: "yes" },
				{ unsupported: [] },
			];

			const errors = yield* Effect.forEach(
				invalidOptions,
				(options) =>
					Effect.flip(
						runSandboxTestScript(
							search,
							{ page: 1, options, pageSize: 20, query: "game" },
							host,
							execution,
						),
					),
				{ concurrency: "unbounded" },
			);
			expect(errors).toHaveLength(invalidOptions.length);
		}),
	);

	it("requests a fresh token on a cache miss and caches it with the computed ttl", () => {
		const cacheWrites: Array<readonly [string, unknown, number]> = [];
		let tokenPosts = 0;
		const host = makeHost({
			setCachedValue: (key, value, ttl) => {
				cacheWrites.push([key, value, ttl]);
				return Effect.succeed(null);
			},
			httpCall: (_method, url) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					tokenPosts += 1;
					return tokenResponse();
				}
				return httpSuccess([], { "x-count": "0" });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "game" }, host, execution).pipe(
				Effect.map((result) => {
					expect(tokenPosts).toBe(1);
					expect(cacheWrites).toEqual([
						["access_token", { clientId: "client-id", accessToken: "Bearer token" }, 3300],
					]);
					expect(result.items).toEqual([]);
					return undefined;
				}),
			),
		);
	});

	it("keeps similar games as related entities", () => {
		const host = makeHost({
			httpCall: (_method, url, options) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return tokenResponse();
				}
				const body = typeof options?.body === "string" ? options.body : "";
				if (url.endsWith("/games") && body.includes("where id = 1;")) {
					return httpSuccess([
						{
							id: 1,
							rating: 80,
							genres: [],
							cover: null,
							artworks: [],
							summary: null,
							name: "Source",
							slug: "source",
							collections: [],
							release_dates: [],
							involved_companies: [],
							first_release_date: 1704067200,
							similar_games: [{ id: 2, name: "Pick One" }],
						},
					]);
				}
				return httpSuccess([]);
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-video-game",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "video-game-group-to-video-game",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [{ externalId: "2", name: "Pick One", providerSlug: "video-game.igdb" }],
						},
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "video-game-to-video-game",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "video-game-to-video-game",
						},
					]);
					return undefined;
				}),
			),
		);
	});

	it("tags search hits with the game type unless it is a main game", () => {
		const host = makeHost({
			httpCall: (_method, url, options) => {
				if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
					return tokenResponse();
				}
				expect(options?.body).toContain(
					"fields id, name, cover.image_id, first_release_date, game_type.type;",
				);
				return httpSuccess([
					{ id: 1, name: "Port", game_type: { type: "Port" }, first_release_date: 1293840000 },
					{ id: 2, name: "Main", first_release_date: 1293840000, game_type: { type: "Main Game" } },
					{ id: 3, name: "Undated Remake", game_type: { type: "Remake" } },
					{ id: 4, name: "Undated Main", game_type: { type: "Main Game" } },
				]);
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "game" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items.map((item) => [item.externalId, item.metadata])).toEqual([
						["1", [2011, "Port"]],
						["2", [2011]],
						["3", ["Remake"]],
						["4", undefined],
					]);
					return undefined;
				}),
			),
		);
	});
});

const SKYRIM_ID = 472;

const skyrim = { id: SKYRIM_ID, name: "Skyrim", slug: "skyrim", game_type: { type: "Main Game" } };

const skyrimChildren = [
	{ id: 2992, name: "Dawnguard", parent_game: SKYRIM_ID, game_type: { type: "DLC" } },
	{ id: 6069, name: "Dragonborn", parent_game: SKYRIM_ID, game_type: { type: "Expansion" } },
	{ id: 19221, name: "Beyond Skyrim", parent_game: SKYRIM_ID, game_type: { type: "Mod" } },
	{ id: 19457, parent_game: SKYRIM_ID, name: "Special Edition", game_type: { type: "Remaster" } },
	{ id: 37034, name: "Skyrim PS3", parent_game: SKYRIM_ID, game_type: { type: "Port" } },
	{
		id: 47445,
		name: "Legendary Edition",
		version_parent: SKYRIM_ID,
		game_type: { type: "Bundle" },
	},
	{ id: 99, name: "Skyrim Bundle", parent_game: SKYRIM_ID, game_type: { type: "Bundle" } },
];

const runDetails = (
	externalId: string,
	routes: {
		readonly game: Record<string, unknown>;
		readonly pages?: ReadonlyArray<ReadonlyArray<unknown>>;
	},
) => {
	const childBodies: Array<string> = [];
	const host = makeHost({
		httpCall: (_method, url, options) => {
			if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
				return tokenResponse();
			}
			const body = typeof options?.body === "string" ? options.body : "";
			if (url.endsWith("/games") && body.includes(`where id = ${externalId};`)) {
				return httpSuccess([routes.game]);
			}
			if (url.endsWith("/games")) {
				childBodies.push(body);
				return httpSuccess(routes.pages?.[childBodies.length - 1] ?? []);
			}
			return httpSuccess([]);
		},
	});
	return runSandboxTestScript(details, { externalId }, host, execution).pipe(
		Effect.map((result) => ({ result, childBodies })),
	);
};

type DetailsResult = Effect.Success<ReturnType<typeof runDetails>>["result"];

const videoGameGroups = (result: DetailsResult, direction: "incoming" | "outgoing") =>
	(result.relatedEntityGroups ?? []).filter(
		(group) =>
			group.relationshipSchemaSlug === "video-game-to-video-game" && group.direction === direction,
	);

const edges = (group: NonNullable<DetailsResult["relatedEntityGroups"]>[number] | undefined) =>
	group?.entities.map((entity) => [entity.externalId, entity.relationshipProperties]);

const modPage = (start: number) =>
	Array.from({ length: 500 }, (_, index) => ({
		id: start + index,
		parent_game: SKYRIM_ID,
		game_type: { type: "Mod" },
		name: `Mod ${start + index}`,
	}));

describe("video-game.igdb game relationships", () => {
	it("derives every child of a parent from one reverse lookup", () =>
		Effect.runPromise(
			runDetails("472", { game: skyrim, pages: [skyrimChildren] }).pipe(
				Effect.map(({ result, childBodies }) => {
					expect(result.properties).toMatchObject({ gameType: "Main Game" });
					expect(childBodies).toHaveLength(1);
					expect(childBodies[0]).toContain("where parent_game = 472 | version_parent = 472;");
					expect(childBodies[0]).toContain("sort id asc;");
					const [outgoing] = videoGameGroups(result, "outgoing");
					expect(outgoing).toMatchObject({ synchronization: "authoritative" });
					expect(edges(outgoing)).toEqual([
						["2992", { kind: "DLC" }],
						["6069", { kind: "Expansion" }],
						["19221", { kind: "Mod" }],
						["19457", { kind: "Remaster" }],
						["37034", { kind: "Port" }],
						["47445", { kind: "Edition" }],
					]);
					expect(videoGameGroups(result, "incoming")).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "video-game-to-video-game",
						},
					]);
					return undefined;
				}),
			),
		));

	it("links a child to its parent with the kind the parent derives", () =>
		Effect.runPromise(
			runDetails("37034", {
				game: {
					id: 37034,
					name: "Skyrim PS3",
					slug: "skyrim-ps3",
					game_type: { type: "Port" },
					parent_game: { id: SKYRIM_ID, name: "Skyrim", game_type: { type: "Main Game" } },
				},
			}).pipe(
				Effect.map(({ result }) => {
					const [incoming] = videoGameGroups(result, "incoming");
					expect(incoming).toMatchObject({ synchronization: "authoritative" });
					expect(edges(incoming)).toEqual([["472", { kind: "Port" }]]);
					return undefined;
				}),
			),
		));

	it("emits one Edition edge when a child sets both parent fields", () =>
		Effect.gen(function* () {
			const both = {
				id: 5,
				name: "Deluxe",
				parent_game: 1,
				version_parent: 1,
				game_type: { type: "Port" },
			};
			const parentSide = yield* runDetails("1", {
				pages: [[both]],
				game: { id: 1, name: "Parent", game_type: { type: "Main Game" } },
			});
			expect(edges(videoGameGroups(parentSide.result, "outgoing")[0])).toEqual([
				["5", { kind: "Edition" }],
			]);
			const childSide = yield* runDetails("5", {
				game: {
					id: 5,
					name: "Deluxe",
					game_type: { type: "Port" },
					version_parent: { id: 1, name: "Parent" },
					parent_game: { id: 1, name: "Parent", game_type: { type: "Main Game" } },
				},
			});
			expect(edges(videoGameGroups(childSide.result, "incoming")[0])).toEqual([
				["1", { kind: "Edition" }],
			]);
		}).pipe(Effect.runPromise));

	it("drops parent_game links that involve a bundle", () =>
		Effect.gen(function* () {
			const parentSide = yield* runDetails("472", {
				game: skyrim,
				pages: [
					[{ id: 99, parent_game: 472, name: "Bundle Child", game_type: { type: "Bundle" } }],
				],
			});
			expect(videoGameGroups(parentSide.result, "outgoing")[0]).toMatchObject({ entities: [] });
			const memberOfBundle = yield* runDetails("7", {
				game: {
					id: 7,
					name: "Bundled",
					game_type: { type: "Main Game" },
					parent_game: { id: 8, name: "A Bundle", game_type: { type: "Bundle" } },
				},
			});
			expect(videoGameGroups(memberOfBundle.result, "incoming")[0]).toMatchObject({ entities: [] });
		}).pipe(Effect.runPromise));

	it("pages the reverse lookup and stays authoritative once a page is short", () => {
		return Effect.runPromise(
			runDetails("472", { game: skyrim, pages: [modPage(1000), skyrimChildren] }).pipe(
				Effect.map(({ result, childBodies }) => {
					expect(childBodies).toHaveLength(2);
					expect(childBodies[1]).toContain("offset 500;");
					const [outgoing] = videoGameGroups(result, "outgoing");
					expect(outgoing).toMatchObject({ synchronization: "authoritative" });
					expect(outgoing?.entities).toHaveLength(506);
					return undefined;
				}),
			),
		);
	});

	it("degrades to additive and stops after four full pages", () => {
		return Effect.runPromise(
			runDetails("472", { game: skyrim, pages: [1000, 2000, 3000, 4000, 5000].map(modPage) }).pipe(
				Effect.map(({ result, childBodies }) => {
					expect(childBodies).toHaveLength(4);
					const [outgoing] = videoGameGroups(result, "outgoing");
					expect(outgoing).toMatchObject({ synchronization: "additive" });
					expect(outgoing?.entities).toHaveLength(2000);
					return undefined;
				}),
			),
		);
	});
});
