import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Search",
	slug: "music.spotify.search",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["spotifyClientId", "spotifyClientSecret"],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
