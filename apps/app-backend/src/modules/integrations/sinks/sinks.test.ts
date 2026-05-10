import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeIntegration } from "../test-support";
import { getSinkAdapterResult } from "./index";
import { parseKodiSinkPayload } from "./kodi";

const json = "application/json";

describe("parseKodiSinkPayload", () => {
	it("maps Kodi show progress to a TMDB show ref", () => {
		const result = parseKodiSinkPayload({
			lot: "show",
			progress: 45,
			identifier: "1234",
			show_season_number: 2,
			show_episode_number: 7,
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

	it("returns an input_transformation failure for malformed payloads", () => {
		const result = parseKodiSinkPayload("not-json");

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Could not parse Kodi webhook payload",
			},
		]);
	});

	it("ignores invalid show season and episode values", () => {
		const result = parseKodiSinkPayload({
			lot: "show",
			progress: 45,
			identifier: "1234",
			show_episode_number: 7.5,
			show_season_number: Number.NaN,
		});

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.events[0]?.properties).toEqual({
			consumedOn: "kodi",
			progressPercent: 45,
		});
	});
});

describe("getSinkAdapterResult", () => {
	it("parses a Kodi webhook raw body", () => {
		const rawBody = JSON.stringify({ lot: "movie", progress: 30, identifier: "603" });
		const result = Effect.runSync(getSinkAdapterResult(makeIntegration(), rawBody, json));

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			externalId: "603",
			scriptSlug: "movie.tmdb",
			entitySchemaSlug: "movie",
		});
	});

	it("returns a source_fetch failure for unsupported sink providers", () => {
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({ provider: "generic_json", providerSpecifics: { kind: "generic_json" } }),
				"{}",
				json,
			),
		);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "source_fetch",
				message: "generic_json integration is not implemented in V2 yet",
			},
		]);
	});

	it("maps an Emby episode webhook to a TMDB show ref", () => {
		const rawBody = JSON.stringify({
			IndexNumber: 3,
			PositionTicks: 50,
			RunTimeTicks: 100,
			ItemType: "Episode",
			ParentIndexNumber: 1,
			SeriesName: "Severance",
			SeriesProvider_tmdb: "95396",
		});
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({ provider: "emby", providerSpecifics: { kind: "emby" } }),
				rawBody,
				json,
			),
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "95396", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{ properties: { showSeason: 1, showEpisode: 3, consumedOn: "emby", progressPercent: 50 } },
			],
		});
	});

	it("skips a Jellyfin webhook when the username does not match", () => {
		const rawBody = JSON.stringify({
			ItemType: "Movie",
			PositionTicks: 50,
			RunTimeTicks: 100,
			Provider_tmdb: "603",
			User: { Name: "bob" },
		});
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "jellyfin_sink",
					providerSpecifics: { kind: "jellyfin_sink", username: "alice" },
				}),
				rawBody,
				json,
			),
		);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([]);
	});

	it("maps a Plex scrobble multipart webhook to a movie ref", () => {
		const payload = JSON.stringify({
			event: "media.scrobble",
			Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
		});
		const rawBody = `--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${payload}\r\n--abc--`;
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({ provider: "plex_sink", providerSpecifics: { kind: "plex_sink" } }),
				rawBody,
				"multipart/form-data; boundary=abc",
			),
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "27205", scriptSlug: "movie.tmdb", entitySchemaSlug: "movie" },
			events: [{ properties: { consumedOn: "plex_sink", progressPercent: 100 } }],
		});
	});

	it("ignores browser extension events from disabled sites", () => {
		const rawBody = JSON.stringify({
			url: "https://www.youtube.com/watch?v=1",
			data: { progress: 80, lot: "movie", identifier: "12345" },
		});
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "ryot_browser_extension",
					providerSpecifics: { kind: "ryot_browser_extension", disabledSites: ["youtube.com"] },
				}),
				rawBody,
				json,
			),
		);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([]);
	});
});
