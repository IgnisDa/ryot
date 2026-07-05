import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Person Search",
	slug: "person.tvdb.search",
	requiredAppConfigKeys: ["moviesAndShows.tvdbApiKey"],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
