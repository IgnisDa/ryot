import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Person Details",
	slug: "person.tmdb.details",
	capabilities: ["httpCall", "getAppConfigValue", "getUserPreferences"],
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
