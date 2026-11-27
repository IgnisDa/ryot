import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildArtistRelated } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music artist related",
	slug: "person.youtube-music.related",
});

export default defineProvider({
	manifest,
	operation: "related",
	run: (input, host) =>
		createYoutubeMusicClient(host, "en").pipe(
			Effect.flatMap((client) => buildArtistRelated(client, input)),
		),
});
