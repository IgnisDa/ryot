import { describe, expect, it } from "bun:test";

import { parseRyotBrowserExtensionSink } from "./ryot-browser-extension";
import { makeSinkIntegration } from "./test-utils";

describe("parseRyotBrowserExtensionSink", () => {
	it("derives the consumedOn provider name from the hostname", async () => {
		const result = await parseRyotBrowserExtensionSink({
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "ryot_browser_extension",
				providerSpecifics: { kind: "ryot_browser_extension" },
			}),
			rawBody: JSON.stringify({
				url: "https://www.netflix.com/watch/1",
				data: {
					lot: "show",
					progress: 80,
					identifier: "900",
					show_season_number: 1,
					show_episode_number: 3,
				},
			}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "900", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { showSeason: 1, showEpisode: 3, progressPercent: 80, consumedOn: "netflix" },
				},
			],
		});
	});

	it("returns an empty result when the hostname matches a disabled site", async () => {
		const result = await parseRyotBrowserExtensionSink({
			contentType: "application/json",
			rawBody: JSON.stringify({
				url: "https://www.netflix.com/watch/1",
				data: { lot: "movie", progress: 80, identifier: "900" },
			}),
			integration: makeSinkIntegration({
				provider: "ryot_browser_extension",
				providerSpecifics: { kind: "ryot_browser_extension", disabledSites: ["netflix.com"] },
			}),
		});

		expect(result).toEqual({ failures: [], entityGroups: [] });
	});

	it("returns an input_transformation failure for malformed payloads", async () => {
		const result = await parseRyotBrowserExtensionSink({
			rawBody: "{}",
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "ryot_browser_extension",
				providerSpecifics: { kind: "ryot_browser_extension" },
			}),
		});

		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse browser extension webhook payload",
			},
		]);
	});
});
