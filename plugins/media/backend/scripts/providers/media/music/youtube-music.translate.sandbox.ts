import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../../youtube-music-shared";
import { buildTrackTranslate } from "./youtube-music";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music translation",
	slug: "music.youtube-music.translate",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) =>
		createYoutubeMusicClient(host, input.language).pipe(
			Effect.flatMap((client) => buildTrackTranslate(client, input.externalId)),
		),
});
