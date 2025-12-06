import { describe, expect, it } from "vitest";

import { type HostFunction, httpSuccess, runProviderDriver, toRecord } from "../test-utils";
import anilistCompanyScriptCode from "./anilist.sandbox.js" with { type: "text" };

const runAnilistCompanyDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(anilistCompanyScriptCode, context, hostFunctions);

describe("company.anilist sandbox script", () => {
	it("emits authoritative studio associations for each media type", () =>
		runAnilistCompanyDetails(
			{ externalId: "1" },
			{
				httpCall: () =>
					httpSuccess({
						data: {
							Studio: {
								id: 1,
								name: "Studio",
								siteUrl: null,
								media: {
									edges: [
										{ node: { id: 2, type: "ANIME", title: { userPreferred: "Anime" } } },
										{ node: { id: 3, type: "MANGA", title: { userPreferred: "Manga" } } },
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
					relationshipSchemaSlug: "company-to-anime",
					entities: [
						{
							name: "Anime",
							externalId: "2",
							scriptSlug: "anime.anilist",
							relationshipProperties: { roles: ["Animation Studio"] },
						},
					],
				},
				{
					direction: "outgoing",
					relationshipSchemaSlug: "company-to-manga",
					entities: [
						{
							name: "Manga",
							externalId: "3",
							scriptSlug: "manga.anilist",
							relationshipProperties: { roles: ["Animation Studio"] },
						},
					],
				},
			]);
		}));
});
