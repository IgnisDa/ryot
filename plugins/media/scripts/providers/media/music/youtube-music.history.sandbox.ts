import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import { createYoutubeHistoryClient } from "../../youtube-music-shared";
import { buildHistory } from "./youtube-music";

export const manifest = defineManifest({
	kind: "script",
	name: "YouTube Music history",
	slug: "music.youtube-music.history",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineScript({
	manifest,
	input: Schema.Struct({
		timezone: Schema.Trim.pipe(Schema.minLength(1, { message: () => "timezone is required" })),
		authCookie: Schema.Trim.pipe(Schema.minLength(1, { message: () => "authCookie is required" })),
	}),
	output: Schema.Struct({
		songs: Schema.Array(Schema.Struct({ title: Schema.String, videoId: Schema.String })),
	}),
	run: (input, host) =>
		createYoutubeHistoryClient(host, input.authCookie).pipe(
			Effect.flatMap((client) => buildHistory(client, input.timezone)),
		),
});
