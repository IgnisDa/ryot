import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./spotify";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Search",
	slug: "music.spotify.search",
	capabilities: ["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
	requiredPluginConfigKeys: ["spotifyClientId", "spotifyClientSecret"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
