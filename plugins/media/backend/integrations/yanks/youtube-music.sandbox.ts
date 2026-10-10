import type { ExecutionMetadata, ScriptHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { readMediaCapture } from "../../imports/collection";
import {
	createYoutubeHistoryClient,
	type HistoryClient,
	type YoutubeMusicHost,
} from "../../lib/vendors/youtube-music";
import { buildHistory, YoutubeMusicSettings } from "../../providers/music/youtube-music/shared";
import { captureIntegrationWindow } from "../artifacts";
import { integrationRecordId } from "../identity";
import { IntegrationWindowOutput, YankInput } from "../schemas";
import { executionStartedAt } from "../shared";
import { confirmIntegrationSource, integrationSourceAttribution } from "../source-state";

export const manifest = defineManifest({
	kind: "script",
	name: "YouTube Music yank",
	slug: "integration.youtube-music",
});

type HistoryClientFactory = (
	host: YoutubeMusicHost,
	authCookie: string,
) => Effect.Effect<HistoryClient, Effect.Error<ReturnType<typeof createYoutubeHistoryClient>>>;
const Cursor = Schema.Struct({
	offset: Schema.Int,
	timezone: Schema.String,
	occurredAt: Schema.String,
	integrationId: Schema.String,
	songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
});
const cursorJson = Schema.fromJsonString(Cursor);

export const dailyProgressWindow = (timezone: string, startedAt: string) => {
	const zoned = DateTime.makeZonedUnsafe(startedAt, { timeZone: timezone });
	const ttlSeconds = Math.max(
		1,
		Math.ceil(
			(DateTime.toEpochMillis(DateTime.endOf(zoned, "day")) + 1 - DateTime.toEpochMillis(zoned)) /
				1_000,
		),
	);
	return {
		ttlSeconds,
		isFinalWindow: ttlSeconds <= 10 * 60,
		localDate: DateTime.formatIsoDate(zoned),
	};
};

export const runYoutubeMusicYank = (
	input: typeof YankInput.Type,
	host: Pick<
		ScriptHost,
		| "log"
		| "span"
		| "httpCall"
		| "getCurrentIntegration"
		| "claimPersistentValue"
		| "getPersistentValue"
	>,
	execution: ExecutionMetadata,
	createClient: HistoryClientFactory = createYoutubeHistoryClient,
) =>
	Effect.gen(function* () {
		if (input.ingestionConfirmation) {
			return {
				...(yield* confirmIntegrationSource(input.ingestionConfirmation, host)),
				carryFile: null,
			};
		}
		const startedAt = yield* executionStartedAt(execution);
		let cursor: typeof Cursor.Type;
		if (input.ingestionArtifacts) {
			cursor = yield* Schema.decodeEffect(cursorJson)(
				new TextDecoder().decode(yield* readMediaCapture("carry")),
			);
		} else {
			const integration = yield* host.getCurrentIntegration();
			const { timezone, authCookie } = yield* Schema.decodeUnknownEffect(YoutubeMusicSettings)(
				integration.providerSpecifics,
			);
			const history = yield* createClient(host, authCookie).pipe(
				Effect.flatMap((client) => buildHistory(client, timezone, startedAt)),
			);
			cursor = {
				timezone,
				offset: 0,
				occurredAt: startedAt,
				integrationId: integration.id,
				songs: [...new Map(history.songs.map((song) => [song.videoId, song])).values()],
			};
		}
		const occurredAt = cursor.occurredAt;
		const timezone = cursor.timezone;
		const songs = cursor.songs.slice(cursor.offset, cursor.offset + 100);
		const { localDate, ttlSeconds, isFinalWindow } = dailyProgressWindow(timezone, occurredAt);
		yield* host.span([
			{
				name: "ytmusic.history.fetched",
				attributes: {
					timezone,
					localDate,
					ttlSeconds,
					isFinalWindow,
					uniqueSongCount: songs.length,
					historySongCount: cursor.songs.length,
				},
			},
		]);
		if (songs.length === 0) {
			yield* host.log([
				{
					level: "warning",
					attributes: { timezone, localDate },
					message: "YouTube Music history returned no songs for the local day",
				},
			]);
		}
		const groups = yield* Effect.forEach(songs, (song, itemIndex) =>
			Effect.gen(function* () {
				const key = `${cursor.integrationId}:${song.videoId}:${localDate}`;
				let progressPercent: number | null = null;
				const completed = yield* host.getPersistentValue(`${key}:completed`);
				if (completed !== true) {
					const seen = yield* host.getPersistentValue(`${key}:seen`);
					progressPercent = isFinalWindow || seen === true ? 100 : 35;
				}
				if (progressPercent === null) {
					return null;
				}
				return {
					collectionMemberships: [],
					itemIndex: cursor.offset + itemIndex,
					entityRef: {
						sourceLabel: song.title,
						externalId: song.videoId,
						kind: "resolved" as const,
						entitySchemaSlug: "music",
						providerSlug: "music.youtube-music",
					},
					events: [
						{
							occurredAt,
							eventSchemaSlug: "progress",
							properties: { progressPercent, consumedOn: "youtube_music" },
							operationId: integrationRecordId(["integration-source-event", key, progressPercent]),
							attribution: integrationSourceAttribution(
								song.videoId,
								song.title,
								progressPercent === 100 ? [`${key}:seen`, `${key}:completed`] : [`${key}:seen`],
								DateTime.toEpochMillis(DateTime.makeUnsafe(occurredAt)) + ttlSeconds * 1000,
							),
						},
					],
				};
			}),
		);
		const entityGroups = groups.filter((group) => group !== null);
		yield* host.span([
			{
				name: "ytmusic.progress.resolved",
				attributes: {
					localDate,
					isFinalWindow,
					emittedCount: entityGroups.length,
					skippedCount: songs.length - entityGroups.length,
				},
			},
			...entityGroups.map((group) => ({
				name: "ytmusic.progress.emitted",
				attributes: {
					itemIndex: group.itemIndex,
					videoId: group.entityRef.externalId,
					sourceLabel: group.entityRef.sourceLabel,
				},
			})),
		]);
		const next =
			cursor.offset + songs.length < cursor.songs.length
				? { ...cursor, offset: cursor.offset + songs.length }
				: null;
		return yield* captureIntegrationWindow(
			manifest.slug,
			{ failures: [], entityGroups },
			next ? yield* Schema.encodeEffect(cursorJson)(next) : null,
		);
	});

export default defineScript({
	manifest,
	input: YankInput,
	run: runYoutubeMusicYank,
	output: IntegrationWindowOutput,
});
