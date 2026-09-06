import type { ExecutionMetadata } from "@ryot-app/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

import { MediaSandboxError } from "../../../lib/failures";
import {
	createYoutubeHistoryClient,
	type HistoryClient,
	type YoutubeMusicHost,
} from "../../../lib/vendors/youtube-music";
import { buildHistory } from "./shared";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	name: "YouTube Music history",
	slug: "music.youtube-music.history",
});

type HistoryClientFactory = (
	host: YoutubeMusicHost,
	authCookie: string,
) => Effect.Effect<HistoryClient, Effect.Error<ReturnType<typeof createYoutubeHistoryClient>>>;

export const runHistory = (
	input: { timezone: string; authCookie: string },
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
	output: Schema.Struct({
		songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
	}),
	input: Schema.Struct({
		timezone: Schema.Trim.pipe(
			Schema.check(Schema.isMinLength(1, { message: "timezone is required" })),
		),
		authCookie: Schema.Trim.pipe(
			Schema.check(Schema.isMinLength(1, { message: "authCookie is required" })),
		),
	}),
});
