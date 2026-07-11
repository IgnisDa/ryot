import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Company Details",
	slug: "company.tmdb.details",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["moviesAndShows.tmdbAccessToken"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
