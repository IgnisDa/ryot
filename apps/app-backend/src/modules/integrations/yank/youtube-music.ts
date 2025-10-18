import { DateTime, Effect, Either, Option, Schema } from "effect";

import { RedisService, redisKeys } from "#lib/redis";
import { finalizeEntityGroups } from "#modules/imports/media/book/shared";
import { nowIso } from "#modules/imports/media/dates";
import { getOrCreateMediaEntityGroup } from "#modules/imports/media/groups";
import type { MediaImportAdapterResult } from "#modules/imports/media/import-processor";
import type { ImportMediaEntityGroup } from "#modules/imports/media/types";

export const YOUTUBE_MUSIC_SCRIPT_SLUG = "music.youtube-music";

const HistoryResult = Schema.Struct({
	songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
});

const decodeHistory = Schema.decodeUnknown(HistoryResult);

type YoutubeMusicTransformInput = {
	userId: string;
	timezone: string;
	integrationId: string;
};

export const sourceFetchFailure = (message: string): MediaImportAdapterResult => ({
	entityGroups: [],
	failures: [{ itemIndex: 0, message, stage: "source_fetch" }],
});

export const deduplicateWindow = (timezone: string): { localDate: string; ttlSeconds: number } =>
	Option.match(DateTime.makeZoned(DateTime.unsafeNow(), { timeZone: timezone }), {
		onNone: () => ({
			ttlSeconds: 86_400,
			localDate: DateTime.formatIsoDateUtc(DateTime.unsafeNow()),
		}),
		onSome: (zoned) => {
			const parts = DateTime.toParts(zoned);
			const elapsed = parts.hours * 3_600 + parts.minutes * 60 + parts.seconds;
			return {
				localDate: DateTime.formatIsoDate(zoned),
				ttlSeconds: Math.max(1, 86_400 - elapsed),
			};
		},
	});

export const buildYoutubeMusicAdapterResult = Effect.fn("youtubeMusic.buildAdapterResult")(
	function* (input: YoutubeMusicTransformInput, sandboxValue: unknown) {
		const redis = yield* RedisService;

		const decoded = yield* decodeHistory(sandboxValue).pipe(Effect.either);
		if (Either.isLeft(decoded)) {
			return sourceFetchFailure("YouTube Music history script returned an unexpected shape");
		}

		const now = nowIso();
		const { localDate, ttlSeconds } = deduplicateWindow(input.timezone);
		const groupMap = new Map<string, ImportMediaEntityGroup>();

		yield* Effect.forEach(decoded.right.songs, (song, idx) =>
			Effect.gen(function* () {
				const cacheKey = redisKeys.integrationCache(
					input.integrationId,
					`${input.userId}:${song.videoId}:${localDate}`,
				);
				const claimed = yield* redis.claim(cacheKey, ttlSeconds);
				const group = getOrCreateMediaEntityGroup(
					groupMap,
					{
						kind: "resolved",
						sourceLabel: song.title,
						externalId: song.videoId,
						entitySchemaSlug: "music",
						scriptSlug: "music.youtube-music",
					},
					idx,
				);
				group.events.push({
					occurredAt: now,
					eventSchemaSlug: "progress",
					properties: { progressPercent: claimed ? 35 : 100, consumedOn: "youtube_music" },
				});
			}),
		);

		return { failures: [], entityGroups: finalizeEntityGroups(groupMap) };
	},
);
