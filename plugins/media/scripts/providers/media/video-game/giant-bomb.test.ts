import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { manifest } from "./giant-bomb";
import details, { manifest as detailsManifest } from "./giant-bomb-details.sandbox";
import search, { manifest as searchManifest } from "./giant-bomb-search.sandbox";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getPluginConfigValue: () => Effect.succeed("api-key"),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("video-game.giant-bomb sandbox script", () => {
	it("declares one narrowly scoped script per operation", () => {
		expect([
			[searchManifest.slug, search.operation, searchManifest.capabilities],
			[detailsManifest.slug, details.operation, detailsManifest.capabilities],
		]).toEqual([
			["video-game.giant-bomb.search", "search", ["httpCall", "getPluginConfigValue"]],
			["video-game.giant-bomb.details", "details", ["httpCall", "getPluginConfigValue"]],
		]);
	});
	it("maps search hits from the GiantBomb search endpoint", () => {
		const host = makeHost((_method, url) => {
			const requestUrl = new URL(url);
			expect(requestUrl.host).toBe("www.giantbomb.com");
			expect(requestUrl.pathname).toBe("/api/search/");
			return httpSuccess({
				error: "OK",
				number_of_total_results: 1,
				results: [
					{
						guid: "3030-1",
						name: "My Game",
						original_release_date: "2015-06-01 00:00:00",
						image: { original_url: "https://img/gb.jpg" },
					},
				],
			});
		});
		return Effect.runPromise(
			runSandboxTestScript(search, { query: "game", page: 1, pageSize: 20 }, host, execution).pipe(
				Effect.map((result) => {
					expect(result).toMatchObject({
						details: { totalItems: 1, nextPage: null },
						items: [
							{
								externalId: "3030-1",
								titleProperty: { kind: "text", value: "My Game" },
								primarySubtitleProperty: { kind: "number", value: 2015 },
							},
						],
					});
					return undefined;
				}),
			),
		);
	});
	it("keeps similar games as related entities", () => {
		const host = makeHost(() =>
			httpSuccess({
				error: "OK",
				results: {
					deck: null,
					genres: [],
					themes: [],
					image: null,
					platforms: [],
					name: "Source",
					developers: [],
					publishers: [],
					franchises: [],
					description: null,
					original_release_date: "2024-01-01",
					site_detail_url: "https://www.giantbomb.com/games/source",
					similar_games: [
						{ name: "Pick One", api_detail_url: "https://www.giantbomb.com/api/game/3030-2/" },
					],
				},
			}),
		);
		return Effect.runPromise(
			runSandboxTestScript(details, { externalId: "3030-1" }, host, execution).pipe(
				Effect.map((result) => {
					expect(result.relatedEntityGroups).toEqual([
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "company-to-video-game",
						},
						{
							entities: [],
							direction: "incoming",
							synchronization: "additive",
							relationshipSchemaSlug: "video-game-group-to-video-game",
						},
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Pick One", externalId: "3030-2", providerSlug: "video-game.giant-bomb" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
});
