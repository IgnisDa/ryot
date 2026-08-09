import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { searchOptions } from "./igdb";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	name: "IGDB Video Game Search Options",
	slug: "video-game.igdb.search-options",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "search-options", run: searchOptions.run });
