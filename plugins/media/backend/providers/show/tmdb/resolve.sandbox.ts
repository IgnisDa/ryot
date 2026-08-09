import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Resolve",
	slug: "show.tmdb.resolve",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "resolve", run: resolve.run });
