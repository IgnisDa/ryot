import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { execution, hostSuccess, integrationRecord } from "../automations/automation-test-utils";
import browserDefinition, { manifest as browserManifest } from "./sinks/browser-extension.sandbox";
import embyDefinition, { manifest as embyManifest } from "./sinks/emby.sandbox";
import genericDefinition, { manifest as genericManifest } from "./sinks/generic-json.sandbox";
import jellyfinDefinition, { manifest as jellyfinManifest } from "./sinks/jellyfin.sandbox";
import kodiDefinition, { manifest as kodiManifest, parseKodi } from "./sinks/kodi.sandbox";
import plexDefinition, { manifest as plexManifest } from "./sinks/plex.sandbox";

const json = "application/json";
const sinkInput = (rawBody: string, contentType = json) => ({ rawBody, contentType });
const runKodi = (rawBody: string) =>
	Effect.runPromise(
		runSandboxTestScript(
			kodiDefinition,
			sinkInput(rawBody),
			defineSandboxTestHost(kodiManifest, {
				getCurrentIntegration: () => hostSuccess(integrationRecord({ provider: "kodi" })),
			}),
			execution,
		),
	);
const multipart = (payload: unknown) =>
	`--abc\r\nContent-Disposition: form-data; name="payload"\r\n\r\n${JSON.stringify(payload)}\r\n--abc--`;

describe("Kodi sink", () => {
	it("maps Kodi show progress to a TMDB show ref", () => {
		const result = Effect.runSync(
			parseKodi(
				JSON.stringify({
					lot: "show",
					progress: 45,
					identifier: "1234",
					show_season_number: 2,
					show_episode_number: 7,
				}),
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "1234", providerSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					eventSchemaSlug: "progress",
					properties: { consumedOn: "kodi", progressPercent: 45 },
					unresolvedEpisode: { type: "show", seasonNumber: 2, episodeNumber: 7 },
				},
			],
		});
	});

	it("returns an input_transformation failure for malformed payloads", () => {
		const result = Effect.runSync(parseKodi(JSON.stringify("not-json")));
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
		const result = Effect.runSync(
			parseKodi(
				JSON.stringify({
					lot: "show",
					progress: 45,
					identifier: "1234",
					show_episode_number: 7.5,
					show_season_number: Number.NaN,
				}),
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "input_transformation",
				message: "Kodi webhook payload is missing show episode coordinates",
			},
		]);
	});

	it("parses a Kodi webhook raw body", async () => {
		const result = await runKodi(JSON.stringify({ lot: "movie", progress: 30, identifier: "603" }));
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]?.entityRef).toMatchObject({
			externalId: "603",
			providerSlug: "movie.tmdb",
			entitySchemaSlug: "movie",
		});
	});
});

describe("media server sinks", () => {
	it("returns a source_fetch failure for unsupported sink providers", async () => {
		const result = await Effect.runPromise(
			runSandboxTestScript(
				genericDefinition,
				sinkInput("{}"),
				defineSandboxTestHost(genericManifest, {
					getCurrentIntegration: () => hostSuccess(integrationRecord({ provider: "generic_json" })),
				}),
				execution,
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

	it("maps an Emby episode webhook to a TMDB show ref", async () => {
		const rawBody = JSON.stringify({
			IndexNumber: 3,
			PositionTicks: 50,
			RunTimeTicks: 100,
			ItemType: "Episode",
			ParentIndexNumber: 1,
			SeriesName: "Severance",
			SeriesProvider_tmdb: "95396",
		});
		const result = await Effect.runPromise(
			runSandboxTestScript(
				embyDefinition,
				sinkInput(rawBody),
				defineSandboxTestHost(embyManifest, {
					getCurrentIntegration: () => hostSuccess(integrationRecord({ provider: "emby" })),
				}),
				execution,
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "95396", providerSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "emby", progressPercent: 50 },
					unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 3 },
				},
			],
		});
	});

	it("maps a Jellyfin episode webhook to a TMDB show ref with an episode locator", async () => {
		const rawBody = JSON.stringify({
			IndexNumber: 4,
			RunTimeTicks: 100,
			PositionTicks: 25,
			SeriesName: "Silo",
			ItemType: "Episode",
			ParentIndexNumber: 2,
			SeriesProvider_tmdb: "125988",
		});
		const result = await Effect.runPromise(
			runSandboxTestScript(
				jellyfinDefinition,
				sinkInput(rawBody),
				defineSandboxTestHost(jellyfinManifest, {
					getCurrentIntegration: () =>
						hostSuccess(integrationRecord({ provider: "jellyfin_sink" })),
				}),
				execution,
			),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "125988", providerSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "jellyfin_sink", progressPercent: 25 },
					unresolvedEpisode: { type: "show", seasonNumber: 2, episodeNumber: 4 },
				},
			],
		});
	});

	it("skips a Jellyfin webhook when the username does not match", async () => {
		const result = await Effect.runPromise(
			runSandboxTestScript(
				jellyfinDefinition,
				sinkInput(
					JSON.stringify({
						ItemType: "Movie",
						PositionTicks: 50,
						RunTimeTicks: 100,
						Provider_tmdb: "603",
						User: { Name: "bob" },
					}),
				),
				defineSandboxTestHost(jellyfinManifest, {
					getCurrentIntegration: () =>
						hostSuccess(integrationRecord({ providerSpecifics: { username: "alice" } })),
				}),
				execution,
			),
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([]);
	});
});

describe("Plex sink", () => {
	const runPlex = (payload: unknown, username?: string) =>
		Effect.runPromise(
			runSandboxTestScript(
				plexDefinition,
				sinkInput(multipart(payload), "multipart/form-data; boundary=abc"),
				defineSandboxTestHost(plexManifest, {
					getCurrentIntegration: () =>
						hostSuccess(
							integrationRecord({
								provider: "plex_sink",
								providerSpecifics: username === undefined ? {} : { username },
							}),
						),
				}),
				execution,
			),
		);

	it("maps a Plex scrobble multipart webhook to a movie ref", async () => {
		const result = await runPlex({
			event: "media.scrobble",
			Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
		});
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "27205", providerSlug: "movie.tmdb", entitySchemaSlug: "movie" },
			events: [{ properties: { consumedOn: "plex_sink", progressPercent: 100 } }],
		});
	});

	it("maps a Plex episode multipart webhook to a TMDB show ref with an episode locator", async () => {
		const result = await runPlex({
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
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "93740", providerSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "plex_sink", progressPercent: 80 },
					unresolvedEpisode: { type: "show", seasonNumber: 3, episodeNumber: 5 },
				},
			],
		});
	});

	it.each([
		["accepts a Plex webhook from any user when the configured username is blank", "   ", false],
		["skips a Plex webhook when the configured username does not match", "alice", true],
		["trims a whitespace-padded Plex username before matching", "  bob  ", false],
	])("%s", async (_name, username, skipped) => {
		const result = await runPlex(
			{
				event: "media.scrobble",
				Account: { title: "bob" },
				Metadata: { type: "movie", title: "Inception", Guid: [{ id: "tmdb://27205" }] },
			},
			username,
		);
		expect(result.failures).toEqual([]);
		if (skipped) {
			expect(result.entityGroups).toEqual([]);
		} else {
			expect(result.entityGroups[0]?.entityRef).toMatchObject({ externalId: "27205" });
		}
	});
});

describe("browser extension sink", () => {
	const runBrowser = (rawBody: string, disabledSites: string[] = []) =>
		Effect.runPromise(
			runSandboxTestScript(
				browserDefinition,
				sinkInput(rawBody),
				defineSandboxTestHost(browserManifest, {
					getCurrentIntegration: () =>
						hostSuccess(integrationRecord({ providerSpecifics: { disabledSites } })),
				}),
				execution,
			),
		);

	it("ignores browser extension events from disabled sites", async () => {
		const result = await runBrowser(
			JSON.stringify({
				url: "https://www.youtube.com/watch?v=1",
				data: { progress: 80, lot: "movie", identifier: "12345" },
			}),
			["youtube.com"],
		);
		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([]);
	});

	it("maps a browser extension show webhook to a TMDB show ref with an episode locator", async () => {
		const result = await runBrowser(
			JSON.stringify({
				url: "https://www.max.com/watch/1",
				data: {
					lot: "show",
					progress: 80,
					identifier: "94997",
					show_season_number: 1,
					show_episode_number: 6,
				},
			}),
		);
		expect(result.failures).toEqual([]);
		expect(result.entityGroups[0]).toMatchObject({
			entityRef: { externalId: "94997", providerSlug: "show.tmdb", entitySchemaSlug: "show" },
			events: [
				{
					properties: { consumedOn: "max", progressPercent: 80 },
					unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 6 },
				},
			],
		});
	});
});
