import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./myanimelist";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList Search",
	slug: "manga.myanimelist.search",
	requiredPluginConfigKeys: ["malClientId"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfigValue", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
