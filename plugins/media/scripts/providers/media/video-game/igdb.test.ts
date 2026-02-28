import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
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
		getPluginConfigValue: (key) =>
			Effect.succeed(key === "twitchClientId" ? "client-id" : "client-secret"),
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
				["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
			],
			[
				"video-game.igdb.details",
				"details",
				["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
			],
		]);
	});
	it("maps search hits and paginates using the x-count header", () => {
		const host = makeHost({
			httpCall: (_method, url) => {
				const requestUrl = new URL(url);
				if (requestUrl.host === "id.twitch.tv") {
					expect(requestUrl.pathname).toBe("/oauth2/token");
					return tokenResponse();
				}
				expect(requestUrl.host).toBe("api.igdb.com");
				expect(requestUrl.pathname).toBe("/v4/games");
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
							direction: "incoming",
							synchronization: "additive",
							entities: [],
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
