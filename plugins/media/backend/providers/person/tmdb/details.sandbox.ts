import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Person Details",
	slug: "person.tmdb.details",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	capabilities: ["httpCall", "getPluginConfig", "getUserSettings"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
