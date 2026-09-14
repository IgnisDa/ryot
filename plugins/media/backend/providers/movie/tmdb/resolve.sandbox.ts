import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Resolve",
	slug: "movie.tmdb.resolve",
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
});

export default defineProvider({ manifest, run: resolve.run, operation: "resolve" });
