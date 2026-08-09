import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./spotify";

export const manifest = defineManifest({
	kind: "provider",
	name: "Spotify Person Details",
	slug: "person.spotify.details",
	requiredPluginConfigKeys: ["spotifyClientId", "spotifyClientSecret"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
