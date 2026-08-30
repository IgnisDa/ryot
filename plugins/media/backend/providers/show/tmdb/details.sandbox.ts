import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Details",
	slug: "show.tmdb.details",
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
