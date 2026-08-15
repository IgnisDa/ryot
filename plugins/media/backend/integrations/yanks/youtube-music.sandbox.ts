import type { ExecutionMetadata, SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot-app/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../imports/schemas";
import {
	createYoutubeHistoryClient,
	type HistoryClient,
	type YoutubeMusicHost,
} from "../../lib/vendors/youtube-music";
import { buildHistory } from "../../providers/music/youtube-music/shared";
import { executionStartedAt, specifics } from "../shared";

export const manifest = defineManifest({
	kind: "script",
	name: "YouTube Music yank",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "integration.youtube-music",
	capabilities: ["httpCall", "getCurrentIntegration", "claimPersistentValue"],
});

const Input = Schema.Struct({});

type HistoryClientFactory = (
	host: YoutubeMusicHost,
	authCookie: string,
) => Effect.Effect<HistoryClient, unknown>;

export const dailyProgressWindow = (timezone: string, startedAt: string) =>
	Option.match(DateTime.makeZoned(DateTime.makeUnsafe(startedAt), { timeZone: timezone }), {
		onNone: () => ({
			ttlSeconds: 86_400,
			isFinalWindow: false,
			localDate: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(startedAt)),
		}),
		onSome: (zoned) => {
			const ttlSeconds = Math.max(
				1,
				Math.ceil(
					(DateTime.toEpochMillis(DateTime.endOf(zoned, "day")) +
						1 -
						DateTime.toEpochMillis(zoned)) /
						1_000,
				),
			);
			return {
				ttlSeconds,
				isFinalWindow: ttlSeconds <= 10 * 60,
				localDate: DateTime.formatIsoDate(zoned),
			};
		},
	});

export const runYoutubeMusicYank = (
	_input: Schema.Schema.Type<typeof Input>,
	host: SandboxHost<typeof manifest.capabilities>,
	execution: ExecutionMetadata,
	createClient: HistoryClientFactory = createYoutubeHistoryClient,
) =>
	Effect.gen(function* () {
		const occurredAt = yield* executionStartedAt(execution);
		const integration = yield* host.getCurrentIntegration();
		const settings = specifics(integration.providerSpecifics);
		const authCookie = typeof settings?.["authCookie"] === "string" ? settings["authCookie"] : "";
		const timezone = typeof settings?.["timezone"] === "string" ? settings["timezone"] : "UTC";
		const history = yield* createClient(host, authCookie).pipe(
			Effect.flatMap((client) => buildHistory(client, timezone, occurredAt)),
		);
		const songs = [...new Map(history.songs.map((song) => [song.videoId, song])).values()];
		const { isFinalWindow, localDate, ttlSeconds } = dailyProgressWindow(timezone, occurredAt);
		const groups = yield* Effect.forEach(songs, (song, itemIndex) =>
			Effect.gen(function* () {
				const key = `${integration.id}:${song.videoId}:${localDate}`;
				let progressPercent: number | null = null;
				if (isFinalWindow) {
					const completed = yield* host.claimPersistentValue(`${key}:completed`, true, ttlSeconds);
					progressPercent = completed.claimed ? 100 : null;
				} else {
					const seen = yield* host.claimPersistentValue(`${key}:seen`, true, ttlSeconds);
					if (seen.claimed) {
						progressPercent = 35;
					} else {
						const completed = yield* host.claimPersistentValue(
							`${key}:completed`,
							true,
							ttlSeconds,
						);
						progressPercent = completed.claimed ? 100 : null;
					}
				}
				if (progressPercent === null) {
					return null;
				}
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
							occurredAt,
							eventSchemaSlug: "progress",
							properties: { progressPercent, consumedOn: "youtube_music" },
						},
					],
				};
			}),
		);
		const entityGroups = groups.filter((group) => group !== null);
		return { failures: [], entityGroups };
	});

export default defineScript({
	manifest,
	input: Input,
	run: runYoutubeMusicYank,
	output: MediaIntegrationAdapterResult,
});
