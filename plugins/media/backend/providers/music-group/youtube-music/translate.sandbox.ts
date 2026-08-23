import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildAlbumTranslate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music album translation",
	slug: "music-group.youtube-music.translate",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) =>
		createYoutubeMusicClient(host, input.language).pipe(
			Effect.flatMap((client) => buildAlbumTranslate(client, input.externalId)),
		),
});
