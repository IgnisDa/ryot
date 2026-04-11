import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Person Search",
	slug: "person.tmdb.search",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfigValue", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
