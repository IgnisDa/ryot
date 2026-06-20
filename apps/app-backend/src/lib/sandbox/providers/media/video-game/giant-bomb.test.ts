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
	it("keeps similar games in suggestions", () => {
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
			expect(details.suggestions).toEqual([
				{ name: "Pick One", externalId: "3030-2", scriptSlug: "video-game.giant-bomb" },
			]);
			return undefined;
		});
	});
});
