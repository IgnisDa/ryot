import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./tmdb";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Person Details",
	slug: "person.tmdb.details",
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
