import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./spotify";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Group Details",
	slug: "music-group.spotify.details",
	requiredAppConfigKeys: ["music.spotifyClientId", "music.spotifyClientSecret"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
