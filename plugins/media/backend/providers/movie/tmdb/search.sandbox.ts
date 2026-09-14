import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Search",
	slug: "movie.tmdb.search",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
