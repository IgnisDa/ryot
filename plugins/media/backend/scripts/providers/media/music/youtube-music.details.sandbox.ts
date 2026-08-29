import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../../youtube-music-shared";
import { buildTrackDetails } from "./youtube-music";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music details",
	slug: "music.youtube-music.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		createYoutubeMusicClient(host, "en").pipe(
			Effect.flatMap((client) => buildTrackDetails(client, input.externalId)),
		),
});
