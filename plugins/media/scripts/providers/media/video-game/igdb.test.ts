import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { describe, expect, it } from "vitest";

import { manifest } from "./igdb";
import details, { manifest as detailsManifest } from "./igdb-details.sandbox";
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
		]);
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
							first_release_date: 1704067200,
							cover: { image_id: "abc" },
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
						filters: {
							genreIds: ["3"],
							platformIds: ["4"],
							gameModeIds: ["5"],
							gameTypeIds: ["6"],
							themeIds: ["1", "2"],
							releaseDateRegionIds: ["7", "8"],
						},
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
				{
					page: 1,
					pageSize: 20,
					query: "game",
					options: { filters: { allowGamesWithParent: true } },
				},
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
				{
					page: 1,
					pageSize: 20,
					query: "game",
					options: { filters: { themeIds: [] } },
				},
				host,
				execution,
			),
		);
	});

	it("rejects invalid search options", async () => {
		const host = makeHost({ httpCall: () => Effect.fail(new Error("unexpected request")) });
		const invalidOptions: ReadonlyArray<Readonly<Record<string, JsonValue>>> = [
			{ filters: { genreIds: [1] } },
			{ filters: { allowGamesWithParent: "yes" } },
			{ filters: { unsupported: [] } },
		];

		for (const options of invalidOptions) {
			expect(
				Effect.runPromise(
					runSandboxTestScript(
						search,
						{ page: 1, pageSize: 20, query: "game", options },
						host,
						execution,
					),
				),
			).rejects.toBeDefined();
		}
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
