import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./igdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Details",
	slug: "video-game.igdb.details",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
