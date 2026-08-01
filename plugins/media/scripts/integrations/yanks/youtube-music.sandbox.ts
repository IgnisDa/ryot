import type { ExecutionMetadata, SandboxHost } from "@ryot/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect, Option, Schema } from "@ryot/sandbox-sdk/effect";

import { MediaIntegrationAdapterResult } from "../../../imports/schemas";
import { buildHistory } from "../../providers/media/music/youtube-music";
import {
	createYoutubeHistoryClient,
	type HistoryClient,
	type YoutubeMusicHost,
} from "../../providers/youtube-music-shared";
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

export const deduplicateWindow = (timezone: string, startedAt: string) =>
	Option.match(DateTime.makeZoned(DateTime.makeUnsafe(startedAt), { timeZone: timezone }), {
		onNone: () => ({
			ttlSeconds: 86_400,
			localDate: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(startedAt)),
		}),
		onSome: (zoned) => {
			const parts = DateTime.toParts(zoned);
			return {
				localDate: DateTime.formatIsoDate(zoned),
				ttlSeconds: Math.max(1, 86_400 - parts.hour * 3_600 - parts.minute * 60 - parts.second),
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
		const { localDate, ttlSeconds } = deduplicateWindow(timezone, occurredAt);
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
							occurredAt,
							eventSchemaSlug: "progress",
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
	});

export default defineScript({
	manifest,
	input: Input,
	output: MediaIntegrationAdapterResult,
	run: runYoutubeMusicYank,
});
