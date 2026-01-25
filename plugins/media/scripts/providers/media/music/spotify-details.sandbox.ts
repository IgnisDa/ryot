import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./spotify";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Details",
	slug: "music.spotify.details",
	capabilities: ["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
	requiredPluginConfigKeys: ["spotifyClientId", "spotifyClientSecret"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
