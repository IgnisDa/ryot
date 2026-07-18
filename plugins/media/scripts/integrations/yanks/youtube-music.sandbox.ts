import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { buildHistory } from "../../providers/media/music/youtube-music";
import { createYoutubeHistoryClient } from "../../providers/youtube-music-shared";
import { specifics } from "../shared";

export const manifest = defineManifest({
	kind: "activity",
	name: "YouTube Music yank",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "integration.youtube-music",
	capabilities: ["httpCall", "getCurrentIntegration", "claimPersistentValue"],
});

const Input = Schema.Struct({});

export const deduplicateWindow = (timezone: string) =>
	Option.match(DateTime.makeZoned(DateTime.nowUnsafe(), { timeZone: timezone }), {
		onNone: () => ({
			ttlSeconds: 86_400,
			localDate: DateTime.formatIsoDateUtc(DateTime.nowUnsafe()),
		}),
		onSome: (zoned) => {
			const parts = DateTime.toParts(zoned);
			return {
				localDate: DateTime.formatIsoDate(zoned),
				ttlSeconds: Math.max(1, 86_400 - parts.hour * 3_600 - parts.minute * 60 - parts.second),
			};
		},
	});

export default defineActivity({
	manifest,
	input: Input,
	output: MediaIntegrationAdapterResult,
	run: (_input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getCurrentIntegration();
			const settings = specifics(integration.providerSpecifics);
			const authCookie = typeof settings?.["authCookie"] === "string" ? settings["authCookie"] : "";
			const timezone = typeof settings?.["timezone"] === "string" ? settings["timezone"] : "UTC";
			const history = yield* createYoutubeHistoryClient(host, authCookie).pipe(
				Effect.flatMap((client) => buildHistory(client, timezone)),
			);
			const { localDate, ttlSeconds } = deduplicateWindow(timezone);
			const entityGroups = yield* Effect.forEach(history.songs, (song, itemIndex) =>
				Effect.gen(function* () {
					const claim = yield* host.claimPersistentValue(
						`${integration.id}:${song.videoId}:${localDate}`,
						true,
						ttlSeconds,
					);
					return {
						itemIndex,
						collectionMemberships: [],
						entityRef: {
							sourceLabel: song.title,
							externalId: song.videoId,
							kind: "resolved" as const,
							entitySchemaSlug: "music",
							providerSlug: "music.youtube-music",
						},
						events: [
							{
								eventSchemaSlug: "progress",
								occurredAt: new Date().toISOString(),
								properties: {
									consumedOn: "youtube_music",
									progressPercent: claim.claimed ? 35 : 100,
								},
							},
						],
					};
				}),
			);
			return { failures: [], entityGroups };
		}),
});
