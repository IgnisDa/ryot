import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Search",
	slug: "show.tmdb.search",
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
