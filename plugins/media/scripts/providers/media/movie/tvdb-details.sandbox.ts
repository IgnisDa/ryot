import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./tvdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Movie Details",
	slug: "movie.tvdb.details",
	requiredAppConfigKeys: ["moviesAndShows.tvdbApiKey"],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
