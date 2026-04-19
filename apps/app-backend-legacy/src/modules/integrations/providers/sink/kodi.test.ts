import { describe, expect, it } from "bun:test";

import { parseKodiSink } from "./kodi";
import { makeSinkIntegration } from "./test-utils";

describe("parseKodiSink", () => {
	it("maps Kodi show progress to a TMDB show ref", async () => {
		const result = await parseKodiSink({
			contentType: "application/json",
			integration: makeSinkIntegration({ provider: "kodi", providerSpecifics: { kind: "kodi" } }),
			rawBody: JSON.stringify({
				lot: "show",
				progress: 45,
				identifier: "1234",
				show_season_number: 2,
				show_episode_number: 7,
			}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "1234", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { showSeason: 2, showEpisode: 7, consumedOn: "kodi", progressPercent: 45 },
				},
			],
		});
	});

	it("returns an input_transformation failure for malformed payloads", async () => {
		const result = await parseKodiSink({
			rawBody: "not-json",
			contentType: "application/json",
			integration: makeSinkIntegration({ provider: "kodi", providerSpecifics: { kind: "kodi" } }),
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse Kodi webhook payload",
			},
		]);
	});
});
