import { describe, expect, it } from "vitest";

import { type HostFunction, httpSuccess, runProviderDriver, toRecord } from "../test-utils";
import anilistPersonScriptCode from "./anilist.sandbox.js" with { type: "text" };

const runAnilistPersonDetails = (context: unknown, hostFunctions: Record<string, HostFunction>) =>
	runProviderDriver(anilistPersonScriptCode, context, hostFunctions);

describe("person.anilist sandbox script", () => {
	it("emits authoritative anime and manga credit groups", () =>
		runAnilistPersonDetails(
			{ externalId: "1" },
			{
				httpCall: () =>
					httpSuccess({
						data: {
							Staff: {
								id: 1,
								gender: null,
								homeTown: null,
								dateOfBirth: {},
								dateOfDeath: {},
								description: null,
								image: { large: null },
								name: { full: "Creator" },
								characterMedia: {
									edges: [
										{
											characters: [{ name: { full: "Hero" } }],
											node: { id: 2, type: "ANIME", title: { userPreferred: "Anime Credit" } },
										},
									],
								},
								staffMedia: {
									edges: [
										{
											staffRole: "Writer",
											node: {
												id: 3,
												type: "MANGA",
												title: { userPreferred: "Manga Credit" },
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
					relationshipSchemaSlug: "person-to-anime",
					entities: [
						{
							externalId: "2",
							name: "Anime Credit",
							scriptSlug: "anime.anilist",
							relationshipProperties: { roles: ["Voicing (Hero)"] },
						},
					],
				},
				{
					direction: "outgoing",
					relationshipSchemaSlug: "person-to-manga",
					entities: [
						{
							externalId: "3",
							name: "Manga Credit",
							scriptSlug: "manga.anilist",
							relationshipProperties: { roles: ["Writer"] },
						},
					],
				},
			]);
		}));
});
