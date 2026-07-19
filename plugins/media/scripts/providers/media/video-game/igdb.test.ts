import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { describe, expect, it } from "vitest";

import { manifest } from "./igdb";
import details, { manifest as detailsManifest } from "./igdb-details.sandbox";
import searchOptions, { manifest as searchOptionsManifest } from "./igdb-search-options.sandbox";
import search, { manifest as searchManifest } from "./igdb-search.sandbox";

type IgdbVideoGameHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown, headers: Record<string, string> = {}) =>
	Effect.succeed({ status: 200, headers, body: JSON.stringify(body) });
const tokenResponse = () =>
	httpSuccess({ access_token: "token", token_type: "bearer", expires_in: 3600 });
const makeHost = (overrides: Partial<IgdbVideoGameHost>): IgdbVideoGameHost =>
	defineSandboxTestHost(manifest, {
		getCachedValue: () => Effect.succeed(null),
		setCachedValue: () => Effect.succeed(null),
		getPluginConfig: (keys) =>
			Effect.succeed(
				Object.fromEntries(
					keys.map((key) => [key, key === "twitchClientId" ? "client-id" : "client-secret"]),
				),
			),
		httpCall: () => Effect.fail(new Error("no route")),
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
			"/v4/themes": [
				{ id: 2, name: "Zelda" },
				{ id: 1, name: "Alpha" },
				{ id: 2, name: "Duplicate" },
				{ id: "invalid", name: "Invalid ID" },
				{ id: 3, name: " " },
				null,
			],
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

	it("fails when an IGDB search-options response is malformed", async () => {
		const host = makeHost({
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				if (requestUrl.host === "id.twitch.tv") {
					return tokenResponse();
				}
				return httpSuccess(requestUrl.pathname === "/v4/themes" ? { invalid: true } : []);
			},
		});

		await expect(
			Effect.runPromise(runSandboxTestScript(searchOptions, {}, host, execution)),
		).rejects.toBeDefined();
	});

	it("propagates IGDB search-options request failures", async () => {
		const host = makeHost({
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				if (requestUrl.host === "id.twitch.tv") {
					return tokenResponse();
				}
				return requestUrl.pathname === "/v4/themes"
					? Effect.fail(new Error("IGDB unavailable"))
					: httpSuccess([]);
			},
		});

		await expect(
			Effect.runPromise(runSandboxTestScript(searchOptions, {}, host, execution)),
		).rejects.toThrow("IGDB unavailable");
	});

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
			runSandboxTestScript(search, { query: "game", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "First Game" },
							primarySubtitleProperty: { kind: "number", value: 2024 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: {
								kind: "image",
								value: {
									type: "remote",
									url: "https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg",
								},
							},
						},
					]);
					expect(result.details).toEqual({ totalItems: 5, nextPage: 2 });
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

	it("rejects invalid search options", async () => {
		const host = makeHost({ httpCall: () => Effect.fail(new Error("unexpected request")) });
		const invalidOptions: ReadonlyArray<Readonly<Record<string, JsonValue>>> = [
			{ genreIds: [1] },
			{ allowGamesWithParent: "yes" },
			{ unsupported: [] },
		];

		await Promise.all(
			invalidOptions.map((options) =>
				expect(
					Effect.runPromise(
						runSandboxTestScript(
							search,
							{ page: 1, pageSize: 20, query: "game", options },
							host,
							execution,
						),
					),
				).rejects.toBeDefined(),
			),
		);
	});

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
			runSandboxTestScript(search, { query: "game", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(tokenPosts).toBe(1);
					expect(cacheWrites).toEqual([
						["access_token", { accessToken: "Bearer token", clientId: "client-id" }, 3300],
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
							entities: [{ name: "Pick One", externalId: "2", providerSlug: "video-game.igdb" }],
						},
					]);
					return undefined;
				}),
			),
		);
	});
});
