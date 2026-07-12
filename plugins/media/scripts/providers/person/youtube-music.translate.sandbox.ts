import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../youtube-music-shared";
import { buildArtistTranslate } from "./youtube-music";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music artist translation",
	slug: "person.youtube-music.translate",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "translate",
	run: (input, host) =>
		createYoutubeMusicClient(host, input.language).pipe(
			Effect.flatMap((client) => buildArtistTranslate(client, input.externalId)),
		),
});
