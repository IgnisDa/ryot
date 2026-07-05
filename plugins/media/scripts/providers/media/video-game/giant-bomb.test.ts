import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./giant-bomb.sandbox";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;
const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });
const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Effect.succeed("api-key"),
	});
const execution = { metadata: {}, sandboxScriptId: "script_test" };
describe("video-game.giant-bomb sandbox script", () => {
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
			runSandboxTestDriver(details, { externalId: "3030-1" }, host, execution).pipe(
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
								{ name: "Pick One", externalId: "3030-2", scriptSlug: "video-game.giant-bomb" },
							],
						},
					]);
					return undefined;
				}),
			),
		);
	});
});
