import { describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { it } from "@voila.dev/effect-bun-test";

import {
	execution,
	httpSuccess,
	integrationRecord,
} from "../../../tests/backend/automations/automation-test-utils";
import { runIntegrationTestScript } from "../artifacts.test-support";
import emby from "../yanks/emby.sandbox";
import jellyfin from "../yanks/jellyfin.sandbox";

describe("media server copy inventories", () => {
	for (const adapter of [jellyfin, emby]) {
		it.live(
			`imports unwatched episode versions with separate technical details from ${adapter.manifest.name}`,
			() =>
				Effect.gen(function* () {
					const host = defineSandboxTestHost(adapter.manifest, {
						getCurrentIntegration: () =>
							Effect.succeed(
								integrationRecord({
									providerSpecifics: {
										apiKey: "key",
										userId: "viewer",
										baseUrl: "https://server.test",
									},
								}),
							),
						httpCall: (_method, url) => {
							const request = new URL(url);
							if (
								request.pathname === "/Users/viewer/Items/series" ||
								request.pathname === "/Items/series"
							) {
								return httpSuccess({ Name: "Series", ProviderIds: { Tmdb: "42" } });
							}
							expect(request.searchParams.get("IncludeItemTypes")).toBe("Movie,Episode");
							return httpSuccess({
								TotalRecordCount: 1,
								Items: [
									{
										Id: "episode",
										Name: "Pilot",
										IndexNumber: 1,
										Type: "Episode",
										SeriesId: "series",
										ParentIndexNumber: 1,
										MediaSources: [
											{
												Id: "4k",
												MediaStreams: [
													{
														Width: 3840,
														Type: "Video",
														IsInterlaced: false,
														VideoRangeType: "DOVI",
													},
													{
														Channels: 8,
														Type: "Audio",
														Codec: "truehd",
														ChannelLayout: "7.1",
														AudioSpatialFormat: "DolbyAtmos",
													},
												],
											},
											{
												Id: "hd",
												Video3DFormat: "HalfSideBySide",
												MediaStreams: [
													{ Width: 1920, Height: 800, Type: "Video", VideoRangeType: "SDR" },
													{ Channels: 2, Codec: "aac", Type: "Audio", ChannelLayout: "stereo" },
												],
											},
										],
									},
								],
							});
						},
					});
					const result = yield* runIntegrationTestScript(adapter, {}, host, execution);
					expect(result.failures).toEqual([]);
					expect(result.entityGroups[0]?.copies).toMatchObject([
						{
							sourceId: '["episode","4k"]',
							unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 1 },
							details: {
								format: "digital",
								resolution: "2160",
								hdr: "dolby-vision",
								audioCodec: "truehd",
								audioChannels: "7.1",
								scanType: "progressive",
								audioSpatialFormat: "dolby-atmos",
							},
						},
						{
							sourceId: '["episode","hd"]',
							unresolvedEpisode: { type: "show", seasonNumber: 1, episodeNumber: 1 },
							details: {
								hdr: "sdr",
								is3d: true,
								format: "digital",
								audioCodec: "aac",
								resolution: "1080",
							},
						},
					]);
				}),
		);
	}
});
