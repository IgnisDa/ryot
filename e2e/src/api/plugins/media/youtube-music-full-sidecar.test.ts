import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueSandboxScript,
	installTestPluginBundle,
	pollSandboxResult,
	providerSandboxSource,
	requireCompletedSandboxValue,
	uninstallTestPlugin,
} from "~/fixtures/kernel";
import { describe, expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";

const text = (value: string) => ({ runs: [{ text: value }] });

const songSearchResponse = {
	contents: {
		tabbedSearchResultsRenderer: {
			tabs: [
				{
					tabRenderer: {
						selected: true,
						content: {
							sectionListRenderer: {
								contents: [
									{
										musicShelfRenderer: {
											title: text("Results"),
											contents: [
												{
													musicResponsiveListItemRenderer: {
														playlistItemData: { videoId: "track" },
														thumbnail: {
															musicThumbnailRenderer: {
																thumbnail: {
																	thumbnails: [
																		{
																			width: 600,
																			height: 600,
																			url: "https://example.com/cover.jpg",
																		},
																	],
																},
															},
														},
														flexColumns: [
															{
																musicResponsiveListItemFlexColumnRenderer: {
																	text: {
																		runs: [
																			{
																				text: "Track",
																				navigationEndpoint: {
																					watchEndpoint: {
																						videoId: "track",
																						watchEndpointMusicSupportedConfigs: {
																							watchEndpointMusicConfig: {
																								musicVideoType: "MUSIC_VIDEO_TYPE_ATV",
																							},
																						},
																					},
																				},
																			},
																		],
																	},
																},
															},
															{ musicResponsiveListItemFlexColumnRenderer: { text: text("3:21") } },
														],
													},
												},
											],
										},
									},
								],
							},
						},
					},
				},
			],
		},
	},
};

const searchSource = (input: {
	readonly name: string;
	readonly slug: string;
	readonly baseUrl: string;
}) => `
import type { ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";
import { createYoutubeMusicClient } from "@ryot-app/sandbox-sdk/youtubei";

export const manifest = defineManifest({
  kind: "provider",
  name: ${JSON.stringify(input.name)},
  slug: ${JSON.stringify(input.slug)},
});

const SearchShelves = Schema.Struct({
  contents: Schema.optional(Schema.Array(Schema.Struct({
    contents: Schema.optional(Schema.Array(Schema.Struct({
      id: Schema.optional(Schema.String),
      title: Schema.optional(Schema.String),
    }))),
  }))),
});

export default defineProvider({
  manifest,
  operation: "search",
  run: (input, host) => Effect.gen(function* () {
    const clientHost: Pick<ScriptHost, "httpCall"> = {
      httpCall: (method, url, options) =>
        host.httpCall(method, ${JSON.stringify(input.baseUrl)} + new URL(url).pathname, options),
    };
    const client = yield* createYoutubeMusicClient(clientHost, undefined, {
      retrievePlayer: false,
      retrieveInnertubeConfig: false,
    });
    const results = yield* Effect.tryPromise(() => client.music.search(input.query, { type: "song" }));
    const shelves = (yield* Schema.decodeUnknownEffect(SearchShelves)(results)).contents ?? [];
    const items = shelves
      .flatMap((shelf) => shelf.contents ?? [])
      .flatMap((track) => (track.id ? [{ externalId: track.id, title: track.title ?? track.id }] : []));
    return { items, details: { nextPage: null, totalItems: items.length } };
  }),
});
`;

describe("YouTube Music on the full sidecar", () => {
	it.live("youtube_music_provider_runs_on_full_sidecar", () =>
		Effect.gen(function* () {
			const http = yield* startFakeHttpServerScoped(() => Response.json(songSearchResponse));
			const providerSlug = `e2e-youtube-music-${crypto.randomUUID()}`;
			const schemaSlug = `e2e-youtube-music-${crypto.randomUUID()}`;
			const searchEntry = `backend/providers/${providerSlug}/search.sandbox.ts`;
			const detailsEntry = `backend/providers/${providerSlug}/details.sandbox.ts`;
			const searchSlug = `${providerSlug}.search`;
			const detailsSlug = `${providerSlug}.details`;
			const plugin = yield* Effect.acquireRelease(
				installTestPluginBundle({
					scope: "system",
					entitySchemas: [
						{
							icon: "file",
							name: "Track",
							slug: schemaSlug,
							eventSchemas: [],
							propertiesSchema: { fields: {} },
						},
					],
					httpRateLimits: [
						{
							requests: 10,
							intervalMs: 1_000,
							origins: [new URL(http.url).origin],
							key: `e2e.youtube-music.${crypto.randomUUID()}`,
						},
					],
					providers: [
						{
							slug: providerSlug,
							name: "YouTube Music",
							information: { source: "e2e" },
							rootEntitySchemaSlug: schemaSlug,
							operations: { search: searchSlug, details: detailsSlug },
						},
					],
					files: {
						[searchEntry]: searchSource({
							slug: searchSlug,
							baseUrl: http.url,
							name: "YouTube Music search",
						}),
						[detailsEntry]: providerSandboxSource({
							slug: detailsSlug,
							operation: "details",
							name: "YouTube Music details",
							result: { name: "Track", properties: {} },
						}),
					},
					scripts: [
						{
							providerSlug,
							capabilities: [],
							kind: "provider",
							slug: detailsSlug,
							entry: detailsEntry,
							providerOperation: "details",
							requiredPluginConfigKeys: [],
							name: "YouTube Music details",
						},
						{
							providerSlug,
							slug: searchSlug,
							kind: "provider",
							entry: searchEntry,
							capabilities: ["httpCall"],
							providerOperation: "search",
							requiredPluginConfigKeys: [],
							name: "YouTube Music search",
						},
					],
				}),
				uninstallTestPlugin,
			);
			const { userId } = yield* createAuthenticatedClient();
			const { jobId } = yield* enqueueSandboxScript(userId, {
				context: { page: 1, pageSize: 20, query: "track" },
				scriptId: plugin.scriptIds[searchSlug] ?? plugin.scriptId,
			});

			const value = requireCompletedSandboxValue(
				yield* pollSandboxResult(userId, jobId),
				"YouTube Music search",
			);
			expect(value).toEqual({
				details: { totalItems: 1, nextPage: null },
				items: [{ title: "Track", externalId: "track" }],
			});
			expect(http.requests.map(({ path }) => path)).toEqual(["/youtubei/v1/search"]);
		}),
	);
});
