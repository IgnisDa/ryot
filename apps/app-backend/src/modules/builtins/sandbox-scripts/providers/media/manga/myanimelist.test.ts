import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./myanimelist.sandbox";

type MyAnimeListMangaHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: MyAnimeListMangaHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "client-id" }),
		getUserPreferences: () =>
			Promise.resolve({
				success: true as const,
				data: { isNsfw: false, disableIntegrations: false },
			}),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("manga.myanimelist sandbox script", () => {
	it("keeps MAL recommendations as related entities", () => {
		const host = makeHost(() =>
			httpSuccess({
				id: 1,
				mean: 8.1,
				genres: [],
				nsfw: "white",
				synopsis: null,
				title: "Source",
				num_volumes: 10,
				num_chapters: 90,
				main_picture: null,
				status: "finished",
				start_date: "2024-01-01",
				recommendations: [{ node: { id: 2, title: "Manga Pick" } }],
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
						{ name: "Manga Pick", externalId: "2", scriptSlug: "manga.myanimelist" },
					],
				},
			]);
			expect(result.properties).toMatchObject({
				volumes: 10,
				chapters: 90,
				isNsfw: false,
				productionStatus: "Finished",
				sourceUrl: "https://myanimelist.net/manga/1/Source",
			});
			return undefined;
		});
	});
});
