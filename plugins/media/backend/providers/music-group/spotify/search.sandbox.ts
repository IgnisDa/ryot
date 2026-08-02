import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	name: "Spotify Music Group Search",
	slug: "music-group.spotify.search",
	requiredPluginConfigKeys: ["spotifyClientId", "spotifyClientSecret"],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
