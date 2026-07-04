import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./igdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Video Game Search",
	slug: "video-game.igdb.search",
	requiredAppConfigKeys: ["videoGames.twitchClientId", "videoGames.twitchClientSecret"],
	capabilities: ["httpCall", "getAppConfigValue", "getCachedValue", "setCachedValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
