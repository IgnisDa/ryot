import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest } from "./giant-bomb.sandbox";

type GiantBombHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: GiantBombHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: () => Promise.resolve({ success: true as const, data: "api-key" }),
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

		return runSandboxTestDriver(details, { externalId: "3030-1" }, host, execution).then(
			(result) => {
				expect(result.relatedEntityGroups).toEqual([
					{
						direction: "incoming",
						synchronization: "additive",
						entities: [],
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
			},
		);
	});
});
