import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { DateTime, Effect, Either, Option, Schema } from "effect";

import { DbRunner } from "~/lib/db";
import { RedisService, redisKeys } from "~/lib/redis";
import { EntitiesRepository } from "~/modules/entities/repository";
import { finalizeEntityGroups } from "~/modules/imports/media/book/shared";
import { nowIso } from "~/modules/imports/media/dates";
import { getOrCreateMediaEntityGroup } from "~/modules/imports/media/groups";
import type { MediaImportAdapterResult } from "~/modules/imports/media/import-processor";
import { RunSandboxWorkflow } from "~/modules/sandbox/workflow-definitions";

const YOUTUBE_MUSIC_SCRIPT_SLUG = "music.youtube-music";

const HistoryResult = Schema.Struct({
	songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
});

const decodeHistory = Schema.decodeUnknown(HistoryResult);

type YoutubeMusicInput = {
	runId: string;
	userId: string;
	timezone: string;
	authCookie: string;
	integrationId: string;
};

const sourceFetchFailure = (message: string): MediaImportAdapterResult => ({
	entityGroups: [],
	failures: [{ itemIndex: 0, message, stage: "source_fetch" }],
});

const errorMessage = (error: unknown): string =>
	typeof error === "object" &&
	error !== null &&
	"message" in error &&
	typeof error.message === "string"
		? error.message
		: "Failed to fetch data from YouTube Music";

export const dedupWindow = (timezone: string): { localDate: string; ttlSeconds: number } =>
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

export const adaptYoutubeMusicData = (input: YoutubeMusicInput) =>
	Effect.gen(function* () {
		const redis = yield* RedisService;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const entitiesRepository = yield* EntitiesRepository;

		const script = yield* runWithDb(
			entitiesRepository.findEntitySchemaScriptBySlug(YOUTUBE_MUSIC_SCRIPT_SLUG),
		);
		if (!script) {
			return sourceFetchFailure("YouTube Music sandbox script is not available");
		}

		const executionId = `${input.runId}_youtube_music_history`;
		const outcome = yield* engine
			.execute(RunSandboxWorkflow, {
				executionId,
				payload: {
					executionId,
					userId: input.userId,
					driverName: "history",
					scriptId: script.sandboxScriptId,
					context: { authCookie: input.authCookie, timezone: input.timezone },
				},
			})
			.pipe(Effect.either);

		if (Either.isLeft(outcome)) {
			return sourceFetchFailure(errorMessage(outcome.left));
		}
		if (outcome.right.error) {
			return sourceFetchFailure(outcome.right.error);
		}

		const decoded = yield* decodeHistory(outcome.right.value).pipe(Effect.either);
		if (Either.isLeft(decoded)) {
			return sourceFetchFailure("YouTube Music history script returned an unexpected shape");
		}

		const now = nowIso();
		const { localDate, ttlSeconds } = dedupWindow(input.timezone);
		const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

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
	});
