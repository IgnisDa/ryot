import { describe, expect, it } from "bun:test";

import { parseJellyfinSink } from "./jellyfin-sink";
import { makeSinkIntegration } from "./test-utils";

describe("parseJellyfinSink", () => {
	it("filters by username and resolves using the configured metadata provider", async () => {
		const result = await parseJellyfinSink({
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "jellyfin_sink",
				providerSpecifics: { username: "alice", kind: "jellyfin_sink", metadataProvider: "tvdb" },
			}),
			rawBody: JSON.stringify({
				User: { Name: "alice" },
				Series: { ProviderIds: { Tvdb: "tv_77" } },
				Session: { PlayState: { PositionTicks: 50 } },
				Item: { IndexNumber: 9, Type: "Episode", RunTimeTicks: 200, ParentIndexNumber: 4 },
			}),
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "tv_77", scriptSlug: "show.tvdb", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: {
						showSeason: 4,
						showEpisode: 9,
						progressPercent: 25,
						consumedOn: "jellyfin_sink",
					},
				},
			],
		});
	});

	it("returns an empty result when the username does not match", async () => {
		const result = await parseJellyfinSink({
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "jellyfin_sink",
				providerSpecifics: { kind: "jellyfin_sink", username: "alice" },
			}),
			rawBody: JSON.stringify({
				User: { Name: "bob" },
				Session: { PlayState: { PositionTicks: 20 } },
				Item: { Type: "Movie", ProviderIds: { Tmdb: "77" }, RunTimeTicks: 100 },
			}),
		});

		expect(result).toEqual({ failures: [], entityGroups: [] });
	});

	it("returns an input_transformation failure for malformed payloads", async () => {
		const result = await parseJellyfinSink({
			rawBody: "not-json",
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "jellyfin_sink",
				providerSpecifics: { kind: "jellyfin_sink" },
			}),
		});

		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse Jellyfin webhook payload",
			},
		]);
	});
});
