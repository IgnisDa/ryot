import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildArtistDetails } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music artist details",
	slug: "person.youtube-music.details",
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		createYoutubeMusicClient(host, "en").pipe(
			Effect.flatMap((client) => buildArtistDetails(client, input.externalId)),
		),
});
