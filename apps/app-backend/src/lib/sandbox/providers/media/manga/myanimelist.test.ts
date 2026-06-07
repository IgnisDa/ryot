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
import myanimelistMangaScriptCode from "./myanimelist.sandbox.js" with { type: "text" };

const myanimelistCode = withTitleCaseHelper(
	titleCaseDelimiterHelperCode,
	myanimelistMangaScriptCode,
);

const runMyanimelistMangaDetails = (
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
) => runProviderDriver(myanimelistCode, context, hostFunctions);

describe("manga.myanimelist sandbox script", () => {
	it("keeps MAL recommendations as related entities", () => {
		return runMyanimelistMangaDetails(
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
						num_volumes: 10,
						num_chapters: 90,
						main_picture: null,
						status: "finished",
						start_date: "2024-01-01",
						recommendations: [{ node: { id: 2, title: "Manga Pick" } }],
						related_anime: [{ node: { id: 3, title: "Related Anime" } }],
						related_manga: [{ node: { id: 4, title: "Related Manga" } }],
					}),
			},
		).then((rawDetails) => {
			const details = toRecord(rawDetails);
			expect(details.relatedEntities).toEqual([
				{
					name: "Related Anime",
					externalId: "3",
					scriptSlug: "anime.myanimelist",
					relationshipSchemaSlug: "media-suggestion",
				},
				{
					name: "Related Manga",
					externalId: "4",
					scriptSlug: "manga.myanimelist",
					relationshipSchemaSlug: "media-suggestion",
				},
				{
					name: "Manga Pick",
					externalId: "2",
					scriptSlug: "manga.myanimelist",
					relationshipSchemaSlug: "media-suggestion",
				},
			]);
			return undefined;
		});
	});
});
