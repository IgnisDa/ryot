import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { createYoutubeMusicClient } from "../../../lib/vendors/youtube-music";
import { buildTrackSearch } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "YouTube Music search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "music.youtube-music.search",
});

export default defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		createYoutubeMusicClient(host).pipe(
			Effect.flatMap((client) => buildTrackSearch(client, input.query, input.pageSize)),
		),
});
