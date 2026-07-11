import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./spotify";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Person Search",
	slug: "person.spotify.search",
	requiredAppConfigKeys: ["music.spotifyClientId", "music.spotifyClientSecret"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
