import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

import { details as anilistAnimeDetails } from "./anime/anilist/shared";
import { details as hardcoverGroupDetails } from "./book-group/hardcover/shared";
import { details as hardcoverBookDetails } from "./book/hardcover/shared";
import { details as openlibraryBookDetails } from "./book/openlibrary/shared";
import { details as metronDetails } from "./comic-book/metron/shared";
import { details as anilistMangaDetails } from "./manga/anilist/shared";
import { details as mangaUpdatesDetails } from "./manga/manga-updates/shared";
import { translate as tmdbGroupTranslate } from "./movie-group/tmdb/shared";
import { translate as tvdbGroupTranslate } from "./movie-group/tvdb/shared";
import { translate as tmdbMovieTranslate } from "./movie/tmdb/shared";
import { translate as tvdbMovieTranslate } from "./movie/tvdb/shared";
import { details as spotifyGroupDetails } from "./music-group/spotify/shared";
import { details as anilistPersonDetails } from "./person/anilist/shared";
import { details as hardcoverPersonDetails } from "./person/hardcover/shared";
import { details as openlibraryPersonDetails } from "./person/openlibrary/shared";
import { translate as tmdbPersonTranslate } from "./person/tmdb/shared";
import { translate as tvdbPersonTranslate } from "./person/tvdb/shared";
import { details as vndbPersonDetails } from "./person/vndb/shared";
import { details as tmdbShowDetails, translate as tmdbShowTranslate } from "./show/tmdb/shared";
import { details as tvdbShowDetails, translate as tvdbShowTranslate } from "./show/tvdb/shared";

const execution = { metadata: {}, sandboxScriptId: "script_test" };
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: ScriptHost["httpCall"]) =>
	defineSandboxTestHost(tmdbShowTranslate.manifest, {
		httpCall,
		setCachedValue: () => Effect.succeed(null),
		getCachedValue: () => Effect.succeed("Bearer token"),
		getPluginConfig: ({ required: keys = [] }) =>
			Effect.succeed(Object.fromEntries(keys.map((key) => [key, "token"]))),
	});

describe("plain provider descriptions", () => {
	it.each([
		[tmdbMovieTranslate, "movie"],
		[tmdbGroupTranslate, "movie-group"],
		[tmdbPersonTranslate, "person"],
		[tmdbShowTranslate, "show"],
		[tmdbShowTranslate, "show-season"],
		[tmdbShowTranslate, "show-episode"],
	] as const)("escapes %s translated %s prose", (provider, entitySchemaSlug) => {
		const host = makeHost((_method, url) =>
			httpSuccess(
				url.includes("/translations")
					? {
							translations: [
								{
									iso_639_1: "fr",
									iso_3166_1: "FR",
									data: {
										name: "Name",
										title: "Title",
										overview: "*literal*",
										biography: "*literal*",
									},
								},
							],
						}
					: {},
			),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				provider,
				{
					externalId: "1",
					entitySchemaSlug,
					language: "fr-FR",
					properties: { seasonNumber: 1, episodeNumber: 1, parentShowExternalId: "1" },
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.properties?.["description"]).toBe("\\*literal\\*");
				}),
			),
		);
	});

	it.each([
		[tvdbMovieTranslate, "movie"],
		[tvdbGroupTranslate, "movie-group"],
		[tvdbPersonTranslate, "person"],
		[tvdbShowTranslate, "show"],
		[tvdbShowTranslate, "show-season"],
		[tvdbShowTranslate, "show-episode"],
	] as const)("escapes %s translated %s prose", (provider, entitySchemaSlug) => {
		const host = makeHost((_method, url) =>
			httpSuccess({
				data: url.includes("/translations/") ? { name: "Name", overview: "*literal*" } : {},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(
				provider,
				{
					externalId: "1",
					entitySchemaSlug,
					language: "fr-FR",
					properties: { parentShowExternalId: "1" },
				},
				host,
				execution,
			).pipe(
				Effect.map((result) => {
					expect(result.properties?.["description"]).toBe("\\*literal\\*");
				}),
			),
		);
	});

	it("escapes TMDB show, season, and episode prose during population", () => {
		const host = makeHost((_method, url) => {
			const { pathname } = new URL(url);
			if (pathname === "/3/tv/1") {
				return httpSuccess({
					name: "Show",
					overview: "*Show*",
					seasons: [{ id: 2, season_number: 1 }],
					"season/1": {
						name: "Season",
						overview: "*Season*",
						episodes: [{ id: 3, name: "Episode", episode_number: 1, overview: "*Episode*" }],
					},
				});
			}
			return httpSuccess({});
		});
		return Effect.runPromise(
			runSandboxTestScript(tmdbShowDetails, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({ description: "\\*Show\\*" });
					expect(result.childEntities).toMatchObject([
						{
							properties: { description: "\\*Season\\*" },
							childEntities: [{ properties: { description: "\\*Episode\\*" } }],
						},
					]);
				}),
			),
		);
	});

	it("escapes TVDB translated show and raw episode prose during population", () => {
		const host = makeHost((_method, url) => {
			const { pathname } = new URL(url);
			if (pathname === "/v4/series/1/extended") {
				return httpSuccess({ data: { name: "Show", seasons: [{ id: 2, number: 1 }] } });
			}
			if (pathname.includes("/translations/")) {
				return httpSuccess({ data: { name: "Show", overview: "*Show*" } });
			}
			if (pathname === "/v4/seasons/2/extended") {
				return httpSuccess({
					data: {
						id: 2,
						number: 1,
						type: { type: "official" },
						episodes: [{ id: 3, number: 1, name: "Episode", overview: "*Episode*" }],
					},
				});
			}
			return httpSuccess({ data: [] });
		});
		return Effect.runPromise(
			runSandboxTestScript(tvdbShowDetails, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({ description: "\\*Show\\*" });
					expect(result.childEntities).toMatchObject([
						{ childEntities: [{ properties: { description: "\\*Episode\\*" } }] },
					]);
				}),
			),
		);
	});
});

describe("rich provider descriptions", () => {
	for (const [provider, payload] of [
		[
			hardcoverBookDetails,
			{
				data: {
					books_by_pk: { title: "Book", description: "<p><strong>Story</strong></p>\n\n*More*" },
				},
			},
		],
		[
			hardcoverGroupDetails,
			{
				data: {
					series_by_pk: { name: "Series", description: "<p><strong>Story</strong></p>\n\n*More*" },
				},
			},
		],
		[
			hardcoverPersonDetails,
			{
				data: { authors_by_pk: { name: "Author", bio: "<p><strong>Story</strong></p>\n\n*More*" } },
			},
		],
		[
			openlibraryBookDetails,
			{ title: "Book", description: { value: "<p><strong>Story</strong></p>\n\n*More*" } },
		],
		[
			openlibraryPersonDetails,
			{ name: "Author", bio: { value: "<p><strong>Story</strong></p>\n\n*More*" } },
		],
		[
			mangaUpdatesDetails,
			{ title: "Manga", description: "<p><strong>Story</strong></p>\n\n*More*" },
		],
		[
			metronDetails,
			{ number: "1", series: { name: "Comic" }, desc: "<p><strong>Story</strong></p>\n\n*More*" },
		],
		[
			spotifyGroupDetails,
			{ name: "Album", description: "<p><strong>Story</strong></p>\n\n*More*" },
		],
	] as const) {
		it(`${provider.manifest.slug} normalizes mixed description prose`, () => {
			const host = makeHost(() => httpSuccess(payload));
			return Effect.runPromise(
				runSandboxTestScript(provider, { externalId: "1" }, host, execution).pipe(
					Effect.map((result) => {
						expect(result.properties).toMatchObject({ description: "**Story**\n\n*More*" });
					}),
				),
			);
		});
	}

	for (const [provider, payload] of [
		[
			anilistAnimeDetails,
			{
				data: {
					Media: {
						type: "ANIME",
						title: { english: "Anime" },
						description:
							'<p><strong>Story</strong></p>\n\n<span class="markdown_spoiler"><em>ending</em></span>\n\n<span class="markdown_spoiler">Secret</span>\n\n~!**raw**!~',
					},
				},
			},
		],
		[
			anilistMangaDetails,
			{
				data: {
					Media: {
						type: "MANGA",
						title: { english: "Manga" },
						description:
							'<p><strong>Story</strong></p>\n\n<span class="markdown_spoiler"><em>ending</em></span>\n\n<span class="markdown_spoiler">Secret</span>\n\n~!**raw**!~',
					},
				},
			},
		],
		[
			anilistPersonDetails,
			{
				data: {
					Staff: {
						name: { full: "Person" },
						description:
							'<p><strong>Story</strong></p>\n\n<span class="markdown_spoiler"><em>ending</em></span>\n\n<span class="markdown_spoiler">Secret</span>\n\n~!**raw**!~',
					},
				},
			},
		],
	] as const) {
		it(`${provider.manifest.slug} requests HTML and preserves formatted spoilers`, () => {
			const host = makeHost((_method, _url, options) => {
				expect(options?.body).toContain("description(asHtml: true)");
				return httpSuccess(payload);
			});
			return Effect.runPromise(
				runSandboxTestScript(provider, { externalId: "1" }, host, execution).pipe(
					Effect.map((result) => {
						expect(result.properties).toMatchObject({
							description:
								"**Story**\n\n:spoiler[*ending*]\n\n:spoiler[Secret]\n\n:spoiler[**raw**]",
						});
					}),
				),
			);
		});
	}

	it("person.vndb converts biography BBCode without exposing spoilers", () => {
		const host = makeHost(() =>
			httpSuccess({
				results: [{ name: "Developer", description: "[b]Biography[/b] [spoiler]hidden[/spoiler]" }],
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(vndbPersonDetails, { externalId: "p1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.properties).toMatchObject({
						description: "**Biography** :spoiler[hidden]",
					});
				}),
			),
		);
	});
});
