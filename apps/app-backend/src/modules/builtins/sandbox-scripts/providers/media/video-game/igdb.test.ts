import { describe, expect, it } from "vitest";

import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
} from "../../test-utils";
import igdbVideoGameScriptCode from "./igdb.sandbox.js" with { type: "text" };

const runIgdbDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(igdbVideoGameScriptCode, context, hostFunctions);

describe("video-game.igdb sandbox script", () => {
	it("keeps similar games as related entities", () => {
		return runIgdbDetails(
			{ externalId: "1" },
			{
				getCachedValue: () => hostSuccess(null),
				setCachedValue: () => hostSuccess(true),
				getAppConfigValue: (...args: Array<unknown>) =>
					hostSuccess(args[0] === "providers.twitchClientId" ? "client-id" : "client-secret"),
				httpCall: (...args: Array<unknown>) => {
					const requestUrl = String(args[1]);
					if (requestUrl.startsWith("https://id.twitch.tv/oauth2/token")) {
						return httpSuccess({ access_token: "token", token_type: "bearer", expires_in: 3600 });
					}
					const options = toRecord(args[2]);
					const body = typeof options.body === "string" ? options.body : "";
					if (requestUrl.endsWith("/games") && body.includes("where id = 1;")) {
						return httpSuccess([
							{
								id: 1,
								rating: 80,
								genres: [],
								cover: null,
								artworks: [],
								summary: null,
								name: "Source",
								slug: "source",
								collections: [],
								release_dates: [],
								involved_companies: [],
								first_release_date: 1_704_067_200,
								similar_games: [{ id: 2, name: "Pick One" }],
							},
						]);
					}
					return httpSuccess([]);
				},
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntities).toEqual([
				{
					name: "Pick One",
					externalId: "2",
					scriptSlug: "video-game.igdb",
					relationshipSchemaSlug: "media-suggestion",
				},
			]);
			return undefined;
		});
	});
});
