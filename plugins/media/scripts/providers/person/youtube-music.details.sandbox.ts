import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../youtube-music-shared";
import { buildArtistDetails } from "./youtube-music";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music artist details",
	slug: "person.youtube-music.details",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		createYoutubeMusicClient(host, "en").pipe(
			Effect.flatMap((client) => buildArtistDetails(client, input.externalId)),
		),
});
