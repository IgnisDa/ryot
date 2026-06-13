import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../../test-utils";
import giantBombVideoGameScriptCode from "./giant-bomb.sandbox.js" with { type: "text" };

const runGiantBombDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(giantBombVideoGameScriptCode, context, hostFunctions);

describe("video-game.giant-bomb sandbox script", () => {
	it("keeps similar games as related entities", () => {
		return runGiantBombDetails(
			{ externalId: "3030-1" },
			{
				getAppConfigValue: () => hostSuccess("api-key"),
				httpCall: () =>
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
								{
									name: "Pick One",
									api_detail_url: "https://www.giantbomb.com/api/game/3030-2/",
								},
							],
						},
					}),
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details["relatedEntityGroups"]).toEqual([
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
		});
	});
});
