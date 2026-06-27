import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeIntegration } from "../test-support";
import { parseKodiSinkPayload } from "./kodi";
import { getSinkAdapterResult } from "./sink-adapters";

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
					properties: { consumedOn: "kodi", progressPercent: 45 },
					episodeLocator: { type: "show", seasonNumber: 2, episodeNumber: 7 },
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

	it("returns an input_transformation failure for invalid show season and episode values", () => {
		const result = parseKodiSinkPayload({
			lot: "show",
			progress: 45,
			identifier: "1234",
			show_episode_number: 7.5,
			show_season_number: Number.NaN,
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Kodi webhook payload is missing show episode coordinates",
			},
		]);
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
				{
					episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 3 },
					properties: { consumedOn: "emby", progressPercent: 50 },
				},
			],
		});
	});

	it("maps a Jellyfin episode webhook to a TMDB show ref with an episode locator", () => {
		const rawBody = JSON.stringify({
			IndexNumber: 4,
			RunTimeTicks: 100,
			PositionTicks: 25,
			SeriesName: "Silo",
			ItemType: "Episode",
			ParentIndexNumber: 2,
			SeriesProvider_tmdb: "125988",
		});
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "jellyfin_sink",
					providerSpecifics: { kind: "jellyfin_sink" },
				}),
				rawBody,
				json,
			),
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "125988", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "jellyfin_sink", progressPercent: 25 },
					episodeLocator: { type: "show", seasonNumber: 2, episodeNumber: 4 },
				},
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

	it("maps a Plex episode multipart webhook to a TMDB show ref with an episode locator", () => {
		const payload = JSON.stringify({
			event: "media.pause",
			Metadata: {
				index: 5,
				duration: 100,
				viewOffset: 80,
				parentIndex: 3,
				type: "episode",
				Guid: [{ id: "tmdb://93740" }],
				grandparentTitle: "Foundation",
			},
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
			entityRef: { externalId: "93740", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "plex_sink", progressPercent: 80 },
					episodeLocator: { type: "show", seasonNumber: 3, episodeNumber: 5 },
				},
			],
		});
	});

	it("accepts a Plex webhook from any user when the configured username is blank", () => {
		const payload = JSON.stringify({
			event: "media.scrobble",
			Account: { title: "someone_else" },
			Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
		});
		const rawBody = `--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${payload}\r\n--abc--`;
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "plex_sink",
					providerSpecifics: { kind: "plex_sink", username: "   " },
				}),
				rawBody,
				"multipart/form-data; boundary=abc",
			),
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "27205", scriptSlug: "movie.tmdb", entitySchemaSlug: "movie" },
		});
	});

	it("skips a Plex webhook when the configured username does not match", () => {
		const payload = JSON.stringify({
			event: "media.scrobble",
			Account: { title: "bob" },
			Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
		});
		const rawBody = `--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${payload}\r\n--abc--`;
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "plex_sink",
					providerSpecifics: { kind: "plex_sink", username: "alice" },
				}),
				rawBody,
				"multipart/form-data; boundary=abc",
			),
		);

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([]);
	});

	it("trims a whitespace-padded Plex username before matching", () => {
		const payload = JSON.stringify({
			event: "media.scrobble",
			Account: { title: "alice" },
			Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
		});
		const rawBody = `--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${payload}\r\n--abc--`;
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "plex_sink",
					providerSpecifics: { kind: "plex_sink", username: "  alice  " },
				}),
				rawBody,
				"multipart/form-data; boundary=abc",
			),
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "27205", scriptSlug: "movie.tmdb", entitySchemaSlug: "movie" },
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

	it("maps a browser extension show webhook to a TMDB show ref with an episode locator", () => {
		const rawBody = JSON.stringify({
			url: "https://www.max.com/watch/1",
			data: {
				lot: "show",
				progress: 80,
				identifier: "94997",
				show_season_number: 1,
				show_episode_number: 6,
			},
		});
		const result = Effect.runSync(
			getSinkAdapterResult(
				makeIntegration({
					provider: "ryot_browser_extension",
					providerSpecifics: { kind: "ryot_browser_extension" },
				}),
				rawBody,
				json,
			),
		);

		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "94997", scriptSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "max", progressPercent: 80 },
					episodeLocator: { type: "show", seasonNumber: 1, episodeNumber: 6 },
				},
			],
		});
	});
});
