import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Music Details",
	slug: "music.spotify.details",
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
	requiredPluginConfigKeys: ["spotifyClientId", "spotifyClientSecret"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
