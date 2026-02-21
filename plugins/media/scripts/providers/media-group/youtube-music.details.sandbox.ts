import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../youtube-music-shared";
import { buildAlbumDetails } from "./youtube-music";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music album details",
	slug: "music-group.youtube-music.details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		createYoutubeMusicClient(host, "en").pipe(
			Effect.flatMap((client) => buildAlbumDetails(client, input.externalId)),
		),
});
