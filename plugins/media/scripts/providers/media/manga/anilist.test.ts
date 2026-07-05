import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./anilist.sandbox";

type AnilistMangaHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: AnilistMangaHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getUserPreferences: () => Effect.succeed({ isNsfw: false, disableIntegrations: false }),
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
		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
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
				}),
			),
		);
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
		return Effect.runPromise(
			runSandboxTestDriver(details, { externalId: "4" }, mangaHost, execution).pipe(
				Effect.flatMap((result) => {
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
					return runSandboxTestDriver(details, { externalId: "4" }, animeHost, execution).pipe(
						Effect.flip,
						Effect.map((error) =>
							expect(String(error)).toContain("Anilist media is not a manga entry"),
						),
					);
				}),
			),
		);
	});
});
