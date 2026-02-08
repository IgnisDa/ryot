import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./igdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Group Search",
	slug: "video-game-group.igdb.search",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
