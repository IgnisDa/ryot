import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./myanimelist.sandbox";

type MyAnimeListAnimeHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: MyAnimeListAnimeHost["httpCall"], isNsfw = false) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "client-id" }),
		getUserPreferences: () =>
			Promise.resolve({ success: true as const, data: { isNsfw, disableIntegrations: false } }),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("anime.myanimelist sandbox script", () => {
	it("keeps MAL recommendations as related entities", () => {
		const host = makeHost(() =>
			httpSuccess({
				id: 1,
				mean: 8.1,
				genres: [],
				nsfw: "white",
				synopsis: null,
				title: "Source",
				num_episodes: 12,
				main_picture: null,
				start_date: "2024-01-01",
				status: "finished_airing",
				recommendations: [{ node: { id: 2, title: "Anime Pick" } }],
				related_anime: [{ node: { id: 3, title: "Related Anime" } }],
				related_manga: [{ node: { id: 4, title: "Related Manga" } }],
			}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Related Anime", externalId: "3", scriptSlug: "anime.myanimelist" },
						{ name: "Related Manga", externalId: "4", scriptSlug: "manga.myanimelist" },
						{ name: "Anime Pick", externalId: "2", scriptSlug: "anime.myanimelist" },
					],
				},
			]);
			return undefined;
		});
	});

	it("maps dates, NSFW flags, status casing, and the single airing entry", () => {
		const host = makeHost(() =>
			httpSuccess({
				id: 1,
				mean: 8.1,
				nsfw: "gray",
				title: "Source",
				num_episodes: 12,
				start_date: "2024-01-05",
				status: "currently_airing",
				synopsis: "Plain synopsis",
				genres: [{ name: "Action" }, { name: "Action" }],
				main_picture: { large: "https://img/l.jpg", medium: "https://img/m.jpg" },
			}),
		);

		return runSandboxTestDriver(details, { externalId: "1" }, host, execution).then((result) => {
			expect(result.properties).toEqual({
				isNsfw: true,
				episodes: 12,
				publishYear: 2024,
				genres: ["Action"],
				providerRating: 8.1,
				publishDate: "2024-01-05",
				description: "Plain synopsis",
				productionStatus: "Currently Airing",
				sourceUrl: "https://myanimelist.net/anime/1/Source",
				airingSchedule: [{ episode: 1, airingAt: "2024-01-05T00:00:00.000Z" }],
				images: [
					{ type: "remote", url: "https://img/l.jpg" },
					{ type: "remote", url: "https://img/m.jpg" },
				],
			});
			return undefined;
		});
	});

	it("requests the nsfw flag only when the user allows it", () => {
		const requestUrls: string[] = [];
		const emptyPage = () => httpSuccess({ data: [], paging: {} });
		const collectUrl = (url: string) => {
			requestUrls.push(url);
			return emptyPage();
		};

		return runSandboxTestDriver(
			search,
			{ query: "hero", page: 1, pageSize: 20 },
			makeHost((_method, url) => collectUrl(url)),
			execution,
		)
			.then(() =>
				runSandboxTestDriver(
					search,
					{ query: "hero", page: 1, pageSize: 20 },
					makeHost((_method, url) => collectUrl(url), true),
					execution,
				),
			)
			.then(() => {
				expect(requestUrls[0]).not.toContain("nsfw=true");
				expect(requestUrls[1]).toContain("nsfw=true");
				expect(requestUrls[0]).toContain("https://api.myanimelist.net/v2/anime?");
				return undefined;
			});
	});

	it("derives paging from the MAL paging cursor", () => {
		const host = makeHost(() =>
			httpSuccess({
				paging: { next: "https://api.myanimelist.net/v2/anime?offset=20" },
				data: [
					{
						node: {
							id: 5,
							title: "Found",
							start_date: "2021-05-10",
							main_picture: { large: "https://img/5.jpg" },
						},
					},
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "found", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "5",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Found" },
					secondarySubtitleProperty: { kind: "null", value: null },
					primarySubtitleProperty: { kind: "number", value: 2021 },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://img/5.jpg" } },
				},
			]);
			expect(result.details).toEqual({ totalItems: 2, nextPage: 2 });
			return undefined;
		});
	});
});
