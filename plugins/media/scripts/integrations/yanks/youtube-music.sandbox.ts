import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { buildHistory } from "../../providers/media/music/youtube-music";
import { createYoutubeHistoryClient } from "../../providers/youtube-music-shared";
import { specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "YouTube Music yank",
	slug: "integration.youtube-music",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getIntegration", "claimCachedValue"],
});
const Input = Schema.Struct({});
export const deduplicateWindow = (timezone: string) =>
	Option.match(DateTime.makeZoned(DateTime.unsafeNow(), { timeZone: timezone }), {
		onNone: () => ({
			ttlSeconds: 86_400,
			localDate: DateTime.formatIsoDateUtc(DateTime.unsafeNow()),
		}),
		onSome: (zoned) => {
			const parts = DateTime.toParts(zoned);
			return {
				localDate: DateTime.formatIsoDate(zoned),
				ttlSeconds: Math.max(1, 86_400 - parts.hours * 3_600 - parts.minutes * 60 - parts.seconds),
			};
		},
	});
export default defineScript({
	manifest,
	input: Input,
	output: MediaIntegrationAdapterResult,
	run: (_input, host) =>
		Effect.gen(function* () {
			const integration = yield* host.getIntegration();
			const settings = specifics(integration.providerSpecifics);
			const authCookie = typeof settings?.["authCookie"] === "string" ? settings["authCookie"] : "";
			const timezone = typeof settings?.["timezone"] === "string" ? settings["timezone"] : "UTC";
			const history = yield* createYoutubeHistoryClient(host, authCookie).pipe(
				Effect.flatMap((client) => buildHistory(client, timezone)),
			);
			const { localDate, ttlSeconds } = deduplicateWindow(timezone);
			const entityGroups = yield* Effect.forEach(history.songs, (song, itemIndex) =>
				Effect.gen(function* () {
					const claim = yield* host.claimCachedValue(
						`${integration.id}:${song.videoId}:${localDate}`,
						true,
						ttlSeconds,
					);
					return {
						itemIndex,
						collectionMemberships: [],
						entityRef: {
							kind: "resolved" as const,
							sourceLabel: song.title,
							externalId: song.videoId,
							entitySchemaSlug: "music",
							providerSlug: "music.youtube-music",
						},
						events: [
							{
								occurredAt: new Date().toISOString(),
								eventSchemaSlug: "progress",
								properties: {
									progressPercent: claim.claimed ? 35 : 100,
									consumedOn: "youtube_music",
								},
							},
						],
					};
				}),
			);
			return { failures: [], entityGroups };
		}),
});
