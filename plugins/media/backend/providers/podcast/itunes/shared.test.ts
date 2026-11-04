import { describe, expect, it } from "bun:test";

import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { mediaFailureMessage } from "../../../lib/error-message";
import details, { manifest as detailsManifest } from "./details.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";
import translate, { manifest as translateManifest } from "./translate.sandbox";

type ItunesHost = Pick<ScriptHost, "httpCall">;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: ItunesHost["httpCall"]) =>
	defineSandboxTestHost(manifest, { httpCall });
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("podcast.itunes sandbox script", () => {
	it("normalizes podcast and episode descriptions during population", () => {
		const host = makeHost((_method, url) =>
			httpSuccess({
				results: url.includes("entity=podcastEpisode")
					? [
							{
								trackId: 55,
								trackName: "Episode",
								releaseDate: "2020-01-01T00:00:00Z",
								description: '<p>Episode <em>notes</em> <a href="/more">more</a></p>',
							},
						]
					: [{ collectionName: "Podcast", description: "<p>Show <strong>summary</strong></p>" }],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "p1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({ description: "Show **summary**" });
					expect(result.childEntities).toMatchObject([
						{
							properties: {
								description: "Episode *notes* [more](https://podcasts.apple.com/more)",
							},
						},
					]);
				}),
			),
		);
	});
	it("returns base podcast metadata without looking up episodes", () => {
		const requests: URL[] = [];
		const host = makeHost((_method, url) => {
			requests.push(new URL(url));
			return httpSuccess({
				results: [
					{
						artistName: "Artist",
						description: "A show.",
						genres: ["Technology"],
						collectionName: "Podcast",
					},
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { level: "base", externalId: "p1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("Podcast");
					expect(result.properties).toMatchObject({
						description: "A show.",
						unlinkedCreators: [{ role: "Artist", name: "Artist" }],
					});
					expect(result.properties).not.toHaveProperty("totalEpisodes");
					expect(result.relatedEntityGroups?.[0]?.relationshipSchemaSlug).toBe("podcast-to-genre");
					expect(result).not.toHaveProperty("childEntities");
					expect(result).not.toHaveProperty("expectedChildEntitySchemaSlug");
					expect(requests).toHaveLength(1);
					expect(requests[0]?.searchParams.get("entity")).toBe("podcast");
					return undefined;
				}),
			),
		);
	});

	it.each(["podcast", "podcast-episode"])(
		"normalizes the translated %s description",
		(entitySchemaSlug) => {
			const host = makeHost(() =>
				httpSuccess({
					results: [
						{
							trackId: 55,
							trackName: "Episode",
							collectionName: "Podcast",
							description: "<p>Translated <strong>summary</strong></p>\n\n*More*",
						},
					],
				}),
			);
			return Effect.runPromise(
				runSandboxTestScript(
					translate,
					{
						language: "fr",
						name: "Episode",
						externalId: "55",
						entitySchemaSlug,
						properties: { parentPodcastExternalId: "p1" },
					},
					host,
					execution,
				).pipe(
					Effect.map((result) => {
						expect(result.properties?.["description"]).toBe("Translated **summary**\n\n*More*");
					}),
				),
			);
		},
	);
	it("declares a script for each operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[translateManifest.slug, translate.operation],
		]).toEqual([
			["podcast.itunes.search", "search"],
			["podcast.itunes.details", "details"],
			["podcast.itunes.translate", "translate"],
		]);
	});
	it("maps search hits, drops entries missing id or title and paginates", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			expect(requestUrl.host).toBe("itunes.apple.com");
			expect(requestUrl.pathname).toBe("/search");
			return httpSuccess({
				results: [
					{
						collectionId: 111,
						collectionName: "First Show",
						releaseDate: "2021-06-01T00:00:00Z",
						artworkUrl600: "https://img/600.jpg",
					},
					{ collectionId: 222, collectionName: "" },
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 2, query: "tech" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							metadata: [2021],
							externalId: "111",
							title: "First Show",
							imageUrl: "https://img/600.jpg",
						},
					]);
					expect(result.details).toEqual({ nextPage: 2 });
					return undefined;
				}),
			),
		);
	});
	it("paginates a full response and reports the exact total when the next request is short", () => {
		const limits: Array<null | string> = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			const limit = requestUrl.searchParams.get("limit");
			limits.push(limit);
			const ids = limit === "2" ? ["1", "2"] : ["1", "2", "3"];
			return httpSuccess({
				results: ids.map((collectionId) => ({
					collectionId,
					collectionName: `Podcast ${collectionId}`,
				})),
			});
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				const first = yield* runSandboxTestScript(
					search,
					{ page: 1, pageSize: 2, query: "news" },
					host,
					execution,
				);
				const second = yield* runSandboxTestScript(
					search,
					{ page: 2, pageSize: 2, query: "news" },
					host,
					execution,
				);
				expect(first.items.map(({ externalId }) => externalId)).toEqual(["1", "2"]);
				expect(first.details).toEqual({ nextPage: 2 });
				expect(second.items.map(({ externalId }) => externalId)).toEqual(["3"]);
				expect(second.details).toEqual({ totalItems: 3, nextPage: null });
				expect(limits).toEqual(["2", "4"]);
			}),
		);
	});
	it("fails when the returned episode inventory is shorter than iTunes trackCount", () => {
		const episodes = Array.from({ length: 200 }, (_, index) => ({
			trackId: index + 1,
			trackName: `Episode ${index + 1}`,
			releaseDate: "2024-01-01T00:00:00Z",
		}));
		const host = makeHost((_method, url) =>
			httpSuccess(
				url.includes("entity=podcastEpisode")
					? { results: episodes }
					: { results: [{ trackCount: 766, collectionName: "Sleep With Me" }] },
			),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "740675898" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) =>
					expect(mediaFailureMessage(error)).toContain(
						"iTunes episode inventory is incomplete: expected 766 unique episodes, received 200",
					),
				),
			),
		);
	});
	it("counts unique valid episode IDs against the known total", () => {
		const host = makeHost((_method, url) =>
			httpSuccess(
				url.includes("entity=podcastEpisode")
					? {
							results: [
								{ trackId: 1, trackName: "Repeated episode", releaseDate: "2024-01-01T00:00:00Z" },
								{ trackId: 1, trackName: "Repeated episode", releaseDate: "2024-01-01T00:00:00Z" },
							],
						}
					: { results: [{ trackCount: 2, collectionName: "Podcast" }] },
			),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "p1" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) =>
					expect(mediaFailureMessage(error)).toContain(
						"iTunes episode inventory is incomplete: expected 2 unique episodes, received 1",
					),
				),
			),
		);
	});
	it("fails when an unknown episode total reaches the 200-episode source limit", () => {
		const episodeLimits: Array<null | string> = [];
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			if (requestUrl.searchParams.get("entity") === "podcastEpisode") {
				episodeLimits.push(requestUrl.searchParams.get("limit"));
				return httpSuccess({
					results: Array.from({ length: 200 }, (_, index) => ({
						trackId: index + 1,
						trackName: `Episode ${index + 1}`,
						releaseDate: "2024-01-01T00:00:00Z",
					})),
				});
			}
			return httpSuccess({ results: [{ collectionName: "Podcast" }] });
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "p1" }, host, execution).pipe(
				Effect.flip,
				Effect.map((error) => {
					expect(mediaFailureMessage(error)).toContain(
						"iTunes episode inventory is incomplete: unknown total reached the 200-episode source limit",
					);
					expect(episodeLimits).toEqual(["200"]);
				}),
			),
		);
	});
	it("stops at the 200-result source ceiling without reporting an exact total", () => {
		const limits: Array<null | string> = [];
		const host = makeHost((_method, url) => {
			const limit = new URL(url).searchParams.get("limit");
			limits.push(limit);
			return httpSuccess({
				results: Array.from({ length: 200 }, (_, index) => ({
					collectionId: index + 1,
					collectionName: `Podcast ${index + 1}`,
				})),
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 100, pageSize: 2, query: "news" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items.map(({ externalId }) => externalId)).toEqual(["199", "200"]);
					expect(result.details).toEqual({ nextPage: null });
					expect(limits).toEqual(["200"]);
				}),
			),
		);
	});
	it("numbers episodes by ascending publish date and converts runtime to minutes", () => {
		const host = makeHost((_method, requestUrl) => {
			if (requestUrl.includes("entity=podcastEpisode")) {
				return httpSuccess({
					results: [
						{
							trackId: 20,
							trackTimeMillis: 1800000,
							trackName: "Later Episode",
							releaseDate: "2020-01-02T00:00:00Z",
							artworkUrl600: "https://img/ep20.jpg",
						},
						{
							trackId: 10,
							trackTimeMillis: 600000,
							trackName: "Earlier Episode",
							releaseDate: "2020-01-01T00:00:00Z",
						},
					],
				});
			}
			return httpSuccess({
				results: [
					{
						trackCount: 2,
						description: "A show.",
						artistName: "Some Artist",
						collectionName: "The Podcast",
						releaseDate: "2020-01-01T00:00:00Z",
						artworkUrl600: "https://img/cover.jpg",
						genres: ["Technology", { name: "News" }],
					},
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "p1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.name).toBe("The Podcast");
					expect(result.expectedChildEntitySchemaSlug).toBe("podcast-episode");
					expect(result.childEntities).toEqual([
						{
							externalId: "10",
							name: "Earlier Episode",
							entitySchemaSlug: "podcast-episode",
							properties: {
								runtime: 10,
								episodeNumber: 1,
								description: null,
								publishDate: "2020-01-01",
								parentPodcastExternalId: "p1",
							},
						},
						{
							externalId: "20",
							name: "Later Episode",
							entitySchemaSlug: "podcast-episode",
							properties: {
								runtime: 30,
								episodeNumber: 2,
								description: null,
								publishDate: "2020-01-02",
								parentPodcastExternalId: "p1",
								images: [{ type: "remote", purpose: "cover", url: "https://img/ep20.jpg" }],
							},
						},
					]);
					expect(result.properties).toMatchObject({
						totalEpisodes: 2,
						publishYear: 2020,
						unlinkedCreators: [{ role: "Artist", name: "Some Artist" }],
						sourceUrl: "https://podcasts.apple.com/us/podcast/the-podcast/idp1",
					});
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "podcast-to-genre",
							entities: [
								{
									name: "Technology",
									externalId: "technology",
									providerSlug: "genre.media-catalog",
								},
								{ name: "News", externalId: "news", providerSlug: "genre.media-catalog" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("translates a podcast entity from the collection payload", () => {
		const host = makeHost(() =>
			httpSuccess({ results: [{ description: "Descripción", collectionName: "Traducido" }] }),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{
					properties: {},
					name: "Podcast",
					externalId: "p1",
					language: "es-ES",
					entitySchemaSlug: "podcast",
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ name: "Traducido", properties: { description: "Descripción" } });
					return undefined;
				}),
			),
		);
	});
	it("translates a podcast episode by locating it in the parent lookup", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [
					{ collectionName: "Parent" },
					{ trackId: 55, trackName: "Episode Title", description: "Episode overview" },
				],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{
					name: "Episode",
					externalId: "55",
					language: "fr-FR",
					entitySchemaSlug: "podcast-episode",
					properties: { parentPodcastExternalId: "p1" },
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result).toEqual({
						name: "Episode Title",
						properties: { description: "Episode overview" },
					});
					return undefined;
				}),
			),
		);
	});
});
