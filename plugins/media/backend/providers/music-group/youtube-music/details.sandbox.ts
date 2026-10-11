import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildAlbumDetails } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music album details",
	slug: "music-group.youtube-music.details",
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		createYoutubeMusicClient(host, "en").pipe(
			Effect.flatMap((client) => buildAlbumDetails(client, input.externalId)),
		),
});
