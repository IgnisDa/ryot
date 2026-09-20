import type { ExecutionMetadata } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { MediaSandboxError } from "../../../lib/failures";
import {
	createYoutubeHistoryClient,
	type HistoryClient,
	type YoutubeMusicHost,
} from "../../../lib/vendors/youtube-music";
import { buildHistory, YoutubeMusicSettings } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	name: "YouTube Music history",
	slug: "music.youtube-music.history",
});

type HistoryClientFactory = (
	host: YoutubeMusicHost,
	authCookie: string,
) => Effect.Effect<HistoryClient, Effect.Error<ReturnType<typeof createYoutubeHistoryClient>>>;

export const runHistory = (
	input: typeof YoutubeMusicSettings.Type,
	host: YoutubeMusicHost,
	execution: ExecutionMetadata,
	createClient: HistoryClientFactory = createYoutubeHistoryClient,
) =>
	createClient(host, input.authCookie).pipe(
		Effect.flatMap((client) =>
			execution.startedAt
				? buildHistory(client, input.timezone, execution.startedAt)
				: Effect.fail(
						new MediaSandboxError({ message: "Sandbox execution startedAt metadata is required" }),
					),
		),
	);

export default defineScript({
	manifest,
	run: runHistory,
	input: YoutubeMusicSettings,
	output: Schema.Struct({
		songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
	}),
});
