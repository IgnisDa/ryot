import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildTrackTranslate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "YouTube Music translation",
	slug: "music.youtube-music.translate",
});

export default defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) =>
		createYoutubeMusicClient(host, input.language).pipe(
			Effect.flatMap((client) => buildTrackTranslate(client, input.externalId)),
		),
});
