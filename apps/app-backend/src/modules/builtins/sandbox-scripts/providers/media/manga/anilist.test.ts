import { describe, expect, it } from "vitest";

import titleCaseDelimiterHelperCode from "../../../script-helpers/title-case-delimiters.sandbox.js" with { type: "text" };
import {
	type HostFunction,
	httpSuccess,
	runProviderDriver,
	toRecord,
	withTitleCaseHelper,
} from "../../test-utils";
import anilistMangaScriptCode from "./anilist.sandbox.js" with { type: "text" };

const anilistCode = withTitleCaseHelper(titleCaseDelimiterHelperCode, anilistMangaScriptCode);

const runAnilistMangaDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(anilistCode, context, hostFunctions, {
		metadata: { providerInformation: { source: "anilist", canonicalLanguage: "en" } },
	});

describe("manga.anilist sandbox script", () => {
	it("keeps recommendations as related entities", () => {
		return runAnilistMangaDetails(
			{ externalId: "1" },
			{
				httpCall: () =>
					httpSuccess({
						data: {
							Media: {
								id: 1,
								tags: [],
								genres: [],
								type: "MANGA",
								isAdult: false,
								averageScore: 80,
								bannerImage: null,
								description: null,
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
					direction: "outgoing",
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
