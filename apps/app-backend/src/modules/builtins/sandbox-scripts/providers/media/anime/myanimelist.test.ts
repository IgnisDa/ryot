import { describe, expect, it } from "vitest";

import titleCaseDelimiterHelperCode from "../../../script-helpers/title-case-delimiters.sandbox.js" with { type: "text" };
import {
	type HostFunction,
	hostSuccess,
	httpSuccess,
	runProviderDriver,
	toRecord,
	withTitleCaseHelper,
} from "../../test-utils";
import myanimelistAnimeScriptCode from "./myanimelist.sandbox.js" with { type: "text" };

const myanimelistCode = withTitleCaseHelper(
	titleCaseDelimiterHelperCode,
	myanimelistAnimeScriptCode,
);

const runMyanimelistAnimeDetails = (
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
) => runProviderDriver(myanimelistCode, context, hostFunctions);

describe("anime.myanimelist sandbox script", () => {
	it("keeps MAL recommendations as related entities", () => {
		return runMyanimelistAnimeDetails(
			{ externalId: "1" },
			{
				getAppConfigValue: () => hostSuccess("client-id"),
				httpCall: () =>
					httpSuccess({
						id: 1,
						mean: 8.1,
						genres: [],
						nsfw: "white",
						synopsis: null,
						title: "Source",
						num_episodes: 12,
						main_picture: null,
						start_date: "2024-01-01",
						status: "finished_airing",
						recommendations: [{ node: { id: 2, title: "Anime Pick" } }],
						related_anime: [{ node: { id: 3, title: "Related Anime" } }],
						related_manga: [{ node: { id: 4, title: "Related Manga" } }],
					}),
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntityGroups).toEqual([
				{
					direction: "outgoing",
					relationshipSchemaSlug: "media-suggestion",
					entities: [
						{ name: "Related Anime", externalId: "3", scriptSlug: "anime.myanimelist" },
						{ name: "Related Manga", externalId: "4", scriptSlug: "manga.myanimelist" },
						{ name: "Anime Pick", externalId: "2", scriptSlug: "anime.myanimelist" },
					],
				},
			]);
			return undefined;
		});
	});
});
