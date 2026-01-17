import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { resolve } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Resolve",
	slug: "show.tmdb.resolve",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
