import { describe, expect, it } from "vitest";

import titleCaseDelimiterHelperCode from "../../../script-helpers/title-case-delimiters.sandbox.js" with { type: "text" };
import {
	type HostFunction,
	httpSuccess,
	runProviderDriver,
	toRecord,
	withTitleCaseHelper,
} from "../../test-utils";
import anilistAnimeScriptCode from "./anilist.sandbox.js" with { type: "text" };

const anilistCode = withTitleCaseHelper(titleCaseDelimiterHelperCode, anilistAnimeScriptCode);

const runAnilistAnimeDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(anilistCode, context, hostFunctions, {
		metadata: { providerInformation: { source: "anilist", canonicalLanguage: "en" } },
	});

describe("anime.anilist sandbox script", () => {
	it("keeps recommendations as related entities", () => {
		return runAnilistAnimeDetails(
			{ externalId: "1" },
			{
				httpCall: () =>
					httpSuccess({
						data: {
							Media: {
								id: 1,
								tags: [],
								genres: [],
								type: "ANIME",
								isAdult: false,
								averageScore: 80,
								description: null,
								bannerImage: null,
								status: "FINISHED",
								startDate: { year: 2020 },
								title: { english: "Source" },
								coverImage: { extraLarge: null },
								recommendations: {
									nodes: [
										{
											mediaRecommendation: {
												id: 2,
												type: "ANIME",
												title: { english: "Anime Pick" },
											},
										},
										{
											mediaRecommendation: {
												id: 3,
												type: "MANGA",
												title: { english: "Manga Pick" },
											},
										},
									],
								},
							},
						},
					}),
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntityGroups).toEqual([
				{
					direction: "incoming",
					synchronization: "additive",
					entities: [],
					relationshipSchemaSlug: "company-to-anime",
				},
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
		});
	});
});
