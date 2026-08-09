import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../youtube-music-shared";
import { buildAlbumSearch } from "./youtube-music";

export const manifest = defineManifest({
	kind: "provider",
	name: "YouTube Music album search",
	slug: "music-group.youtube-music.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		createYoutubeMusicClient(host).pipe(
			Effect.flatMap((client) => buildAlbumSearch(client, input.query, input.pageSize)),
		),
});
