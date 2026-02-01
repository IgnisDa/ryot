import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./listennotes";
import details, { manifest as detailsManifest } from "./listennotes-details.sandbox";
import search, { manifest as searchManifest } from "./listennotes-search.sandbox";

type ListennotesHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

const makeHost = (
	httpCall: ListennotesHost["httpCall"],
	overrides: Partial<ListennotesHost> = {},
) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfigValue: () => Effect.succeed("listen-key"),
		getCachedValue: () => Effect.succeed(null),
		setCachedValue: () => Effect.succeed(null),
		...overrides,
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("podcast.listennotes sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
		]).toEqual([
			["podcast.listennotes.search", "search"],
			["podcast.listennotes.details", "details"],
		]);
	});

	it("loads the API key and sends it in the Listen Notes auth header", () => {
		const configKeys: string[] = [];
		const host = defineSandboxTestHost(manifest, {
			getCachedValue: () => Effect.succeed(null),
			setCachedValue: () => Effect.succeed(null),
			getPluginConfigValue: (key) => {
				configKeys.push(key);
				return Effect.succeed("listen-key");
			},
			httpCall: (_method, url, options) => {
				const requestUrl = new URL(url);
				expect(requestUrl.host).toBe("listen-api.listennotes.com");
				expect(requestUrl.pathname).toBe("/api/v2/search");
				expect(options?.headers).toEqual({ "X-ListenAPI-Key": "listen-key" });
				return httpSuccess({ total: 0, next_offset: null, results: [] });
			},
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "news", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map(() => {
					expect(configKeys).toEqual(["listennotesApiKey"]);
					return undefined;
				}),
			),
		);
	});

	it("maps search hits and derives nextPage from next_offset", () => {
		const host = makeHost(() =>
			httpSuccess({
				total: 42,
				next_offset: 20,
				results: [
					{
						id: "abc",
						image: "https://img/a.jpg",
						title_original: "A Podcast",
						earliest_pub_date_ms: 1577836800000,
					},
					{ id: "", title: "No Id" },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "news", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "abc",
							calloutProperty: { kind: "null", value: null },
							titleProperty: { kind: "text", value: "A Podcast" },
							primarySubtitleProperty: { kind: "number", value: 2020 },
							secondarySubtitleProperty: { kind: "null", value: null },
							imageProperty: { kind: "image", value: { type: "remote", url: "https://img/a.jpg" } },
						},
					]);
					expect(result.details).toEqual({ totalItems: 42, nextPage: 2 });
					return undefined;
				}),
			),
		);
	});

	it("reads the cached genre map and remaps recommendations into a media-suggestion group", () => {
		const host = makeHost(
			(_method, requestUrl) => {
				if (requestUrl.includes("/recommendations")) {
					return httpSuccess({
						recommendations: [
							{ id: "rec-1", title: "Recommended One", thumbnail: "https://img/rec1.jpg" },
							{ id: "", title: "Dropped" },
						],
					});
				}
				return httpSuccess({
					listen_score: 62,
					total_episodes: 1,
					title: "My Podcast",
					genre_ids: [67, 999],
					explicit_content: true,
					publisher: "Acme Media",
					description: "A great show.",
					image: "https://img/cover.jpg",
					earliest_pub_date_ms: 1577836800000,
					next_episode_pub_date: 1577836800000,
					episodes: [
						{
							id: "ep-1",
							title: "Episode One",
							audio_length_sec: 3600,
							pub_date_ms: 1577836800000,
							description: "First episode.",
							thumbnail: "https://img/ep1.jpg",
						},
					],
				});
			},
			{
				getCachedValue: () => Effect.succeed({ "67": "Comedy" }),
			},
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "pod-1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("My Podcast");
					expect(result.expectedChildEntitySchemaSlug).toBe("podcast-episode");
					expect(result.childEntities).toEqual([
						{
							externalId: "ep-1",
							name: "Episode One",
							entitySchemaSlug: "podcast-episode",
							properties: {
								runtime: 60,
								episodeNumber: 1,
								publishDate: "2020-01-01",
								description: "First episode.",
								images: [{ type: "remote", url: "https://img/ep1.jpg" }],
							},
						},
					]);
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{
									externalId: "rec-1",
									name: "Recommended One",
									providerSlug: "podcast.listennotes",
								},
							],
						},
					]);
					expect(result.properties).toMatchObject({
						isNsfw: true,
						totalEpisodes: 1,
						publishYear: 2020,
						genres: ["Comedy"],
						providerRating: 62,
						publishDate: "2020-01-01",
						description: "A great show.",
						images: [{ type: "remote", url: "https://img/cover.jpg" }],
						unlinkedCreators: [{ role: "Publishing", name: "Acme Media" }],
						sourceUrl: "https://www.listennotes.com/podcasts/My Podcast-pod-1",
					});
					return undefined;
				}),
			),
		);
	});
});
