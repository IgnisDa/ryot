import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Movie Search",
	slug: "movie.tvdb.search",
	requiredAppConfigKeys: ["moviesAndShows.tvdbApiKey"],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
