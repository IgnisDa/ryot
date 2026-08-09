import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Resolve",
	slug: "movie.tmdb.resolve",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
