import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	name: "TMDB Person Translate",
	slug: "person.tmdb.translate",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
