import { describe, expect, it } from "bun:test";

import { parseEmbySink } from "./emby";
import { makeSinkIntegration } from "./test-utils";

describe("parseEmbySink", () => {
	it("calculates episode progress from tick ratio and resolves via TMDB", async () => {
		const result = await parseEmbySink({
			contentType: "application/json",
			integration: makeSinkIntegration({ provider: "emby", providerSpecifics: { kind: "emby" } }),
			rawBody: JSON.stringify({
				PlaybackInfo: { PositionTicks: 100 },
				Series: { ProviderIds: { Tmdb: "555" } },
				Item: {
					IndexNumber: 7,
					Type: "Episode",
					RunTimeTicks: 400,
					ParentIndexNumber: 3,
					Name: "Episode Seven",
					SeriesName: "Show One",
				},
			}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "555", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { showSeason: 3, showEpisode: 7, consumedOn: "emby", progressPercent: 25 },
				},
			],
		});
	});

	it("returns an input_transformation failure when the payload has no TMDB id", async () => {
		const result = await parseEmbySink({
			contentType: "application/json",
			integration: makeSinkIntegration({ provider: "emby", providerSpecifics: { kind: "emby" } }),
			rawBody: JSON.stringify({
				PlaybackInfo: { PositionTicks: 25 },
				Item: { Type: "Movie", RunTimeTicks: 100 },
			}),
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Emby webhook payload is missing a TMDB identifier",
			},
		]);
	});
});
