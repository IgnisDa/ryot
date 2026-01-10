import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./listennotes.sandbox";

type ListennotesHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (
	httpCall: ListennotesHost["httpCall"],
	overrides: Partial<ListennotesHost> = {},
) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("listen-key"),
		getCachedValue: () => Effect.succeed(null),
		setCachedValue: () => Effect.succeed(null),
		...overrides,
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("podcast.listennotes sandbox script", () => {
	it("maps search hits and derives nextPage from next_offset", () => {
		const host = makeHost(() =>
			httpSuccess({
				total: 42,
				next_offset: 20,
				results: [
					{
						id: "abc",
						title_original: "A Podcast",
						image: "https://img/a.jpg",
						earliest_pub_date_ms: 1577836800000,
					},
					{ id: "", title: "No Id" },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestDriver(search, { query: "news", page: 1, pageSize: 20 }, host, execution).pipe(
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
					title: "My Podcast",
					total_episodes: 1,
					genre_ids: [67, 999],
					listen_score: 62,
					explicit_content: true,
					publisher: "Acme Media",
					image: "https://img/cover.jpg",
					description: "A great show.",
					earliest_pub_date_ms: 1577836800000,
					next_episode_pub_date: 1577836800000,
					episodes: [
						{
							id: "ep-1",
							title: "Episode One",
							audio_length_sec: 3600,
							pub_date_ms: 1577836800000,
							thumbnail: "https://img/ep1.jpg",
							description: "First episode.",
						},
					],
				});
			},
			{
				getCachedValue: () => Effect.succeed({ "67": "Comedy" }),
			},
		);
		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "pod-1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("My Podcast");
					expect(result.childEntities).toEqual([
						{
							entitySchemaSlug: "podcast-episode",
							externalId: "ep-1",
							name: "Episode One",
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
								{ name: "Recommended One", externalId: "rec-1", scriptSlug: "podcast.listennotes" },
							],
						},
					]);
					expect(result.properties).toMatchObject({
						isNsfw: true,
						totalEpisodes: 1,
						providerRating: 62,
						genres: ["Comedy"],
						publishYear: 2020,
						description: "A great show.",
						publishDate: "2020-01-01",
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
