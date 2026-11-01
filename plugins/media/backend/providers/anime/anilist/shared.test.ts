import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";
import { manifest } from "./shared";
import translate, { manifest as translateManifest } from "./translate.sandbox";

type AnilistAnimeHost = Pick<ScriptHost, "httpCall" | "getUserSettings">;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: AnilistAnimeHost["httpCall"], allowNsfw = false) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getUserSettings: () => Effect.succeed({ allowNsfw }),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
const searchResponse = () =>
	httpSuccess({ data: { Page: { media: [], pageInfo: { total: 41 } } } });

describe("anime.anilist sandbox script", () => {
	it("fetches all three airing schedule pages and keeps the unpaged studios inventory", () => {
		const bodies: string[] = [];
		const host = makeHost((_method, _url, options) => {
			bodies.push(options?.body ?? "");
			const page = bodies.length;
			return httpSuccess({
				data: {
					Media: {
						id: 1,
						genres: [],
						type: "ANIME",
						description: null,
						title: { english: "Source" },
						recommendations: { nodes: [] },
						studios: { nodes: [{ id: 5, name: "Studio" }] },
						airingSchedule: {
							pageInfo: { hasNextPage: page < 3 },
							nodes: [
								{ episode: page, airingAt: 1700000000 + page * 60 },
								{ episode: page, airingAt: 1700000000 + page * 60 },
							],
						},
					},
				},
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(bodies).toHaveLength(3);
					expect(bodies[0]).toContain("recommendations(page: 1, perPage: 25, sort: RATING_DESC)");
					expect(bodies[1]).toContain('"page":2');
					expect(bodies[2]).toContain('"page":3');
					expect(result.properties).toMatchObject({
						airingSchedule: [
							{ episode: 1, airingAt: "2023-11-14T22:14:20.000Z" },
							{ episode: 2, airingAt: "2023-11-14T22:15:20.000Z" },
							{ episode: 3, airingAt: "2023-11-14T22:16:20.000Z" },
						],
					});
					expect(result.relatedEntityGroups?.[0]).toMatchObject({
						synchronization: "authoritative",
						coverage: { status: "complete" },
					});
				}),
			),
		);
	});
	it("declares one script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
			[translateManifest.slug, translate.operation],
		]).toEqual([
			["anime.anilist.search", "search"],
			["anime.anilist.details", "details"],
			["anime.anilist.translate", "translate"],
		]);
	});
	it("keeps recommendations as related entities", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						genres: [],
						type: "ANIME",
						isAdult: false,
						averageScore: 80,
						description: null,
						bannerImage: null,
						status: "FINISHED",
						studios: { nodes: [] },
						startDate: { year: 2020 },
						title: { english: "Source" },
						coverImage: { extraLarge: null },
						airingSchedule: { nodes: [], pageInfo: { hasNextPage: false } },
						recommendations: {
							nodes: [
								{ mediaRecommendation: { id: 2, type: "ANIME", title: { english: "Anime Pick" } } },
								{ mediaRecommendation: { id: 3, type: "MANGA", title: { english: "Manga Pick" } } },
							],
						},
					},
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "company-to-anime",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ externalId: "2", name: "Anime Pick", providerSlug: "anime.anilist" },
								{ externalId: "3", name: "Manga Pick", providerSlug: "manga.anilist" },
							],
						},
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							coverage: { status: "complete" },
							relationshipSchemaSlug: "anime-to-genre",
						},
					]);
					return undefined;
				}),
			),
		);
	});

	it("fails when an AniList studio has an invalid identity", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						genres: [],
						type: "ANIME",
						description: null,
						studios: { nodes: [{}] },
						title: { english: "Source" },
						recommendations: { nodes: [] },
						airingSchedule: { nodes: [], pageInfo: { hasNextPage: false } },
					},
				},
			}),
		);

		return Effect.runPromise(
			Effect.flip(runSandboxTestScript(details, { externalId: "1" }, host, execution)).pipe(
				Effect.map((error) =>
					expect(error).toMatchObject({ message: "AniList studio identity is malformed" }),
				),
			),
		);
	});

	it("preserves description formatting, title-cases status, and orders the airing schedule", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						isAdult: true,
						type: "ANIME",
						episodes: 24.7,
						averageScore: 84,
						recommendations: null,
						startDate: { year: 2020 },
						status: "NOT_YET_RELEASED",
						title: { english: "Source" },
						bannerImage: "https://img/banner.jpg",
						tags: [{ name: "Space" }, { name: "" }],
						coverImage: { extraLarge: "https://img/cover.jpg" },
						nextAiringEpisode: { episode: 3, airingAt: 1700001200 },
						genres: ["Action", "Action", "sci-fi", "Science Fiction"],
						description: 'Line one<br>Line <span class="markdown_spoiler"><i>two</i></span>',
						studios: {
							nodes: [
								{ id: 5, name: "Studio A" },
								{ id: 5, name: "Duplicate" },
							],
						},
						airingSchedule: {
							pageInfo: { hasNextPage: false },
							nodes: [
								{ episode: 2, airingAt: 1700000600 },
								{ episode: 1, airingAt: 1700000000 },
							],
						},
					},
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups?.[0]?.entities).toEqual([
						{
							externalId: "5",
							name: "Studio A",
							providerSlug: "company.anilist",
							relationshipProperties: { roles: ["Animation Studio"] },
						},
					]);
					expect(result.properties).toEqual({
						episodes: 24,
						isNsfw: true,
						publishYear: 2020,
						providerRating: 84,
						productionStatus: "Not Yet Released",
						sourceUrl: "https://anilist.co/anime/1/Source",
						description: "Line one\\\nLine :spoiler[*two*]",
						images: [
							{ type: "remote", purpose: "cover", url: "https://img/cover.jpg" },
							{ type: "remote", purpose: "backdrop", url: "https://img/banner.jpg" },
						],
						airingSchedule: [
							{ episode: 1, airingAt: "2023-11-14T22:13:20.000Z" },
							{ episode: 2, airingAt: "2023-11-14T22:23:20.000Z" },
							{ episode: 3, airingAt: "2023-11-14T22:33:20.000Z" },
						],
					});
					expect(result.relatedEntityGroups?.[2]).toEqual({
						direction: "outgoing",
						synchronization: "authoritative",
						coverage: { status: "complete" },
						relationshipSchemaSlug: "anime-to-genre",
						entities: [
							{ name: "Action", externalId: "action", providerSlug: "genre.media-catalog" },
							{
								name: "Science Fiction",
								externalId: "science fiction",
								providerSlug: "genre.media-catalog",
							},
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("requests non-adult media only until the user allows NSFW", () => {
		const requestBodies: string[] = [];
		const collectBody = (options: undefined | { body?: string | undefined }) => {
			requestBodies.push(options?.body ?? "");
			return searchResponse();
		};
		return Effect.runPromise(
			runSandboxTestScript(
				search,
				{ page: 2, pageSize: 20, query: "hero" },
				makeHost((_method, url, options) => {
					expect(new URL(url).host).toBe("graphql.anilist.co");
					return collectBody(options);
				}),
				execution,
			).pipe(
				Effect.flatMap((result) => {
					expect(result.details).toEqual({ nextPage: 3, totalItems: 41 });
					return runSandboxTestScript(
						search,
						{ page: 3, pageSize: 20, query: "hero" },
						makeHost((_method, url, options) => {
							expect(new URL(url).host).toBe("graphql.anilist.co");
							return collectBody(options);
						}, true),
						execution,
					);
				}),
				Effect.map((result) => {
					expect(result.details).toEqual({ totalItems: 41, nextPage: null });
					const [defaultBody, nsfwBody] = requestBodies.map((body): unknown => JSON.parse(body));
					expect(defaultBody).toMatchObject({
						variables: { page: 2, perPage: 20, type: "ANIME", search: "hero", isAdult: false },
					});
					expect(nsfwBody).toHaveProperty("variables", {
						page: 3,
						perPage: 20,
						type: "ANIME",
						search: "hero",
					});
					return undefined;
				}),
			),
		);
	});
	it("maps search items and drops entries without usable ids or titles", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Page: {
						pageInfo: { total: 3 },
						media: [
							{
								id: 7,
								startDate: { year: 2001 },
								title: { romaji: "Romaji Pick" },
								coverImage: { extraLarge: "https://img/7.jpg" },
							},
							{ id: 0, title: { english: "Dropped Id" } },
							{ id: 9, title: {} },
						],
					},
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(search, { page: 1, pageSize: 20, query: "pick" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.items).toEqual([
						{
							externalId: "7",
							metadata: [2001],
							title: "Romaji Pick",
							imageUrl: "https://img/7.jpg",
						},
					]);
					return undefined;
				}),
			),
		);
	});
	it("translates only supported languages using the requested title", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						type: "ANIME",
						title: { romaji: "Romaji", native: "Native", english: "English" },
					},
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				translate,
				{
					name: "Anime",
					properties: {},
					externalId: "1",
					language: "ja-latn",
					entitySchemaSlug: "anime",
				},
				host,
				execution,
			).pipe(
				Effect.flatMap((result) => {
					expect(result).toEqual({ name: "Romaji" });
					return runSandboxTestScript(
						translate,
						{
							name: "Anime",
							language: "fr",
							properties: {},
							externalId: "1",
							entitySchemaSlug: "anime",
						},
						host,
						execution,
					);
				}),
				Effect.map((result) => {
					expect(result).toEqual({});
					return undefined;
				}),
			),
		);
	});
	it("rejects non-numeric external ids", () => {
		const host = makeHost(() => httpSuccess({ data: {} }));
		return expect(
			Effect.runPromise(runSandboxTestScript(details, { externalId: "abc" }, host, execution)),
		).rejects.toThrow("externalId must be a numeric Anilist media id");
	});
});
