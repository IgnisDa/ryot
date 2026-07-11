import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { translate } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Translate",
	slug: "movie.tmdb.translate",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
