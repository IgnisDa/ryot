import type { ExecutionMetadata } from "@ryot/sandbox-sdk/core";
import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import {
	createYoutubeHistoryClient,
	type HistoryClient,
	type YoutubeMusicHost,
} from "../../youtube-music-shared";
import { buildHistory } from "./youtube-music";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "YouTube Music history",
	slug: "music.youtube-music.history",
});

type HistoryClientFactory = (
	host: YoutubeMusicHost,
	authCookie: string,
) => Effect.Effect<HistoryClient, unknown>;

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
				: Effect.fail(new Error("Sandbox execution startedAt metadata is required")),
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
