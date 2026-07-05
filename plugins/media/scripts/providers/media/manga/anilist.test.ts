import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./anilist.sandbox";

type AnilistMangaHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: AnilistMangaHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getUserPreferences: () =>
			Promise.resolve({
				success: true as const,
				data: { isNsfw: false, disableIntegrations: false },
			}),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("manga.anilist sandbox script", () => {
	it("keeps recommendations as related entities", () => {
		const host = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 1,
						tags: [],
						genres: [],
						type: "MANGA",
						isAdult: false,
						averageScore: 80,
						bannerImage: null,
						description: null,
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

	it("truncates volumes, keeps raw chapters, and rejects non-manga media", () => {
		const mangaHost = makeHost(() =>
			httpSuccess({
				data: {
					Media: {
						id: 4,
						tags: [],
						genres: [],
						type: "MANGA",
						volumes: 10.9,
						isAdult: false,
						chapters: 90.5,
						averageScore: 71,
						bannerImage: null,
						description: null,
						status: "RELEASING",
						recommendations: null,
						startDate: { year: 2018 },
						coverImage: { extraLarge: null },
						title: { english: "Long Runner" },
					},
				},
			}),
		);

		return runSandboxTestDriver(details, { externalId: "4" }, mangaHost, execution).then(
			(result) => {
				expect(result.properties).toMatchObject({
					volumes: 10,
					chapters: 90.5,
					publishYear: 2018,
					productionStatus: "Releasing",
					sourceUrl: "https://anilist.co/manga/4/Long%20Runner",
				});
				const animeHost = makeHost(() =>
					httpSuccess({ data: { Media: { id: 4, type: "ANIME", title: { english: "X" } } } }),
				);
				return expect(
					runSandboxTestDriver(details, { externalId: "4" }, animeHost, execution),
				).rejects.toThrow("Anilist media is not a manga entry");
			},
		);
	});
});
