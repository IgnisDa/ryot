import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./spotify";
import details, { manifest as detailsManifest } from "./spotify-details.sandbox";
import search, { manifest as searchManifest } from "./spotify-search.sandbox";

type SpotifyMusicHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
type Route = {
	match: (url: string) => boolean;
	body: unknown;
};
const makeHost = (
	routes: readonly Route[],
	overrides: Partial<SpotifyMusicHost> = {},
): SpotifyMusicHost =>
	defineSandboxTestHost(manifest, {
		getPluginConfigValue: (key) => Effect.succeed(key.endsWith("Secret") ? "secret" : "id"),
		getCachedValue: () => Effect.succeed("cached-token"),
		setCachedValue: () => Effect.succeed(null),
		httpCall: (_method, url) => {
			const route = routes.find((candidate) => candidate.match(url));
			return route ? httpSuccess(route.body) : Effect.fail(new Error(`no route: ${url}`));
		},
		...overrides,
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("music.spotify sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
		]).toEqual([
			[
				"music.spotify.search",
				"search",
				["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
			],
			[
				"music.spotify.details",
				"details",
				["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
			],
		]);
	});
	it("maps track search hits, drops entries without an id, and reuses the cached token", () => {
		let tokenPosts = 0;
		const searchBody = {
			tracks: {
				total: 2,
				items: [
					{
						id: "t1",
						name: "Track One",
						album: {
							release_date: "2020-05-01",
							images: [
								{ url: "https://img/small.jpg", width: 64, height: 64 },
								{ url: "https://img/big.jpg", width: 640, height: 640 },
							],
						},
					},
					{ name: "No Id" },
				],
			},
		};
		const host = makeHost([], {
			httpCall: (_method, url) => {
				if (url.includes("accounts.spotify.com")) {
					tokenPosts += 1;
					return httpSuccess({ access_token: "unexpected" });
				}
				return url.includes("/search")
					? httpSuccess(searchBody)
					: Effect.fail(new Error(`no route: ${url}`));
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "track", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(tokenPosts).toBe(0);
					expect(result.items).toEqual([
						{
							externalId: "t1",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "Track One" },
							primarySubtitleProperty: { kind: "number", value: 2020 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: {
								kind: "image",
								value: { type: "remote", url: "https://img/big.jpg" },
							},
						},
					]);
					expect(result.details).toEqual({ totalItems: 2, nextPage: null });
					return undefined;
				}),
			),
		);
	});
	it("groups artists and the album, and maps track scalar properties", () => {
		const host = makeHost([
			{
				match: (url) => url.includes("/tracks/"),
				body: {
					id: "t1",
					explicit: true,
					popularity: 73,
					name: "The Track",
					duration_ms: 215000,
					external_urls: { spotify: "https://open.spotify.com/track/t1" },
					artists: [
						{ id: "a1", name: "First Artist" },
						{ id: "a2", name: "Second Artist" },
					],
					album: {
						id: "al1",
						name: "The Album",
						release_date: "2019-03-15",
						images: [{ url: "https://img/cover.jpg", width: 300, height: 300 }],
					},
				},
			},
		]);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "t1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Track");
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "person-to-music",
							entities: [
								{
									externalId: "a1",
									name: "First Artist",
									providerSlug: "person.spotify",
									relationshipProperties: { roles: ["Artist"] },
								},
								{
									externalId: "a2",
									name: "Second Artist",
									providerSlug: "person.spotify",
									relationshipProperties: { roles: ["Artist"] },
								},
							],
						},
						{
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "music-group-to-music",
							entities: [
								{
									name: "The Album",
									externalId: "al1",
									providerSlug: "music-group.spotify",
									relationshipProperties: { roles: ["Member"] },
								},
							],
						},
					]);
					expect(result.properties).toEqual({
						genres: [],
						isNsfw: true,
						duration: 215,
						publishYear: 2019,
						providerRating: 73,
						byVariousArtists: true,
						publishDate: "2019-03-15",
						sourceUrl: "https://open.spotify.com/track/t1",
						images: [{ type: "remote", url: "https://img/cover.jpg" }],
					});
					return undefined;
				}),
			),
		);
	});
	it("requests a fresh token on a cache miss and caches it with the computed ttl", () => {
		const cacheWrites: Array<readonly [string, unknown, number]> = [];
		const host = makeHost([{ match: (url) => url.includes("/search"), body: { tracks: {} } }], {
			getCachedValue: () => Effect.succeed(null),
			setCachedValue: (key, value, ttl) => {
				cacheWrites.push([key, value, ttl]);
				return Effect.succeed(null);
			},
			httpCall: (_method, url) => {
				if (url.includes("accounts.spotify.com")) {
					return httpSuccess({ access_token: "fresh-token", expires_in: 3600 });
				}
				return url.includes("/search")
					? httpSuccess({ tracks: { total: 0, items: [] } })
					: Effect.fail(new Error(`no route: ${url}`));
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "track", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(cacheWrites).toEqual([["spotify_access_token", "fresh-token", 3300]]);
					expect(result.items).toEqual([]);
					return undefined;
				}),
			),
		);
	});
});
