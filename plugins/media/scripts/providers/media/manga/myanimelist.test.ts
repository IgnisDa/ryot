import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./myanimelist";
import details, { manifest as detailsManifest } from "./myanimelist-details.sandbox";
import search, { manifest as searchManifest } from "./myanimelist-search.sandbox";

type MyAnimeListMangaHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: MyAnimeListMangaHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfigValue: () => Effect.succeed("client-id"),
		getUserPreferences: () => Effect.succeed({ isNsfw: false, disableIntegrations: false }),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("manga.myanimelist sandbox script", () => {
	it("declares one script per operation", () => {
		expect([
			[searchManifest.slug, search.operation],
			[detailsManifest.slug, details.operation],
		]).toEqual([
			["manga.myanimelist.search", "search"],
			["manga.myanimelist.details", "details"],
		]);
	});
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
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Related Anime", externalId: "3", providerSlug: "anime.myanimelist" },
								{ name: "Related Manga", externalId: "4", providerSlug: "manga.myanimelist" },
								{ name: "Manga Pick", externalId: "2", providerSlug: "manga.myanimelist" },
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
				}),
			),
		);
	});
});
