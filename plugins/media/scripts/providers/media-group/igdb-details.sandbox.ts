import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./igdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Group Details",
	slug: "video-game-group.igdb.details",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfigValue", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
