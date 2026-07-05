import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Group Search",
	slug: "movie-group.tmdb.search",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
