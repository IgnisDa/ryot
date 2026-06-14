import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search, translate } from "./anilist.sandbox";

type AnilistAnimeHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: AnilistAnimeHost["httpCall"], isNsfw = false) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getUserPreferences: () =>
			Promise.resolve({ success: true as const, data: { isNsfw, disableIntegrations: false } }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("anime.anilist sandbox script", () => {
	it("keeps recommendations as related entities", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						tags: [],
						genres: [],
						type: "ANIME",
						isAdult: false,
						averageScore: 80,
						description: null,
						bannerImage: null,
						status: "FINISHED",
						startDate: { year: 2020 },
						title: { english: "Source" },
						coverImage: { extraLarge: null },
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

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.relatedEntityGroups).toEqual([
				{
					entities: [],
					direction: "incoming",
					synchronization: "additive",
					relationshipSchemaSlug: "company-to-anime",
				},
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Anime Pick", externalId: "2", scriptSlug: "anime.anilist" },
						{ name: "Manga Pick", externalId: "3", scriptSlug: "manga.anilist" },
					],
				},
			]);
			return undefined;
		});
	});

	it("cleans HTML descriptions, title-cases status, and orders the airing schedule", () => {
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
						genres: ["Action", "Action"],
						bannerImage: "https://img/banner.jpg",
						tags: [{ name: "Space" }, { name: "" }],
						description: "Line one<br>Line <i>two</i>",
						coverImage: { extraLarge: "https://img/cover.jpg" },
						nextAiringEpisode: { episode: 3, airingAt: 1700001200 },
						studios: {
							nodes: [
								{ id: 5, name: "Studio A" },
								{ id: 5, name: "Duplicate" },
							],
						},
						airingSchedule: {
							nodes: [
								{ episode: 2, airingAt: 1700000600 },
								{ episode: 1, airingAt: 1700000000 },
							],
						},
					},
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.relatedEntityGroups?.[0]?.entities).toEqual([
				{
					externalId: "5",
					name: "Studio A",
					scriptSlug: "company.anilist",
					relationshipProperties: { roles: ["Animation Studio"] },
				},
			]);
			expect(result.properties).toEqual({
				episodes: 24,
				isNsfw: true,
				publishYear: 2020,
				providerRating: 84,
				genres: ["Action", "Space"],
				description: "Line one\nLine two",
				productionStatus: "Not Yet Released",
				sourceUrl: "https://anilist.co/anime/1/Source",
				images: [
					{ type: "remote", url: "https://img/cover.jpg" },
					{ type: "remote", url: "https://img/banner.jpg" },
				],
				airingSchedule: [
					{ episode: 1, airingAt: "2023-11-14T22:13:20.000Z" },
					{ episode: 2, airingAt: "2023-11-14T22:23:20.000Z" },
					{ episode: 3, airingAt: "2023-11-14T22:33:20.000Z" },
				],
			});
			return undefined;
		});
	});

	it("requests non-adult media only until the user allows NSFW", () => {
		const requestBodies: string[] = [];
		const searchResponse = () =>
			httpSuccess({ data: { Page: { pageInfo: { total: 41 }, media: [] } } });
		const collectBody = (options: { body?: string | undefined } | undefined) => {
			requestBodies.push(options?.body ?? "");
			return searchResponse();
		};

		return runSandboxTestDriver(
			search,
			{ query: "hero", page: 2, pageSize: 20 },
			makeHost((_method, _url, options) => collectBody(options)),
			execution,
		)
			.then((result) => {
				expect(result.details).toEqual({ totalItems: 41, nextPage: 3 });
				return runSandboxTestDriver(
					search,
					{ query: "hero", page: 3, pageSize: 20 },
					makeHost((_method, _url, options) => collectBody(options), true),
					execution,
				);
			})
			.then((result) => {
				expect(result.details).toEqual({ totalItems: 41, nextPage: null });
				const [defaultBody, nsfwBody] = requestBodies.map((body): unknown => JSON.parse(body));
				expect(defaultBody).toMatchObject({
					variables: { type: "ANIME", search: "hero", page: 2, perPage: 20, isAdult: false },
				});
				expect(nsfwBody).toMatchObject({ variables: { isAdult: null } });
				return undefined;
			});
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

		return runSandboxTestDriver(
			search,
			{ query: "pick", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "7",
					titleProperty: { kind: "text", value: "Romaji Pick" },
					calloutProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
					primarySubtitleProperty: { kind: "number", value: 2001 },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://img/7.jpg" } },
				},
			]);
			return undefined;
		});
	});

	it("translates only supported languages using the requested title", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						type: "ANIME",
						title: { english: "English", romaji: "Romaji", native: "Native" },
					},
				},
			}),
		);

		return runSandboxTestDriver(
			translate,
			{ externalId: "1", language: "ja-latn", entitySchemaSlug: "anime" },
			host,
			execution,
		)
			.then((result) => {
				expect(result).toEqual({ name: "Romaji" });
				return runSandboxTestDriver(
					translate,
					{ externalId: "1", language: "fr", entitySchemaSlug: "anime" },
					host,
					execution,
				);
			})
			.then((result) => {
				expect(result).toEqual({});
				return undefined;
			});
	});

	it("rejects non-numeric external ids", () => {
		const host = makeHost(() => httpSuccess({ data: {} }));
		return expect(
			runSandboxTestDriver(details, { externalId: "abc" }, host, execution),
		).rejects.toThrow("externalId must be a numeric Anilist media id");
	});
});
