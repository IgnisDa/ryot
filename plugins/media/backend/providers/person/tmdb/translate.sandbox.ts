import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Person Translate",
	slug: "person.tmdb.translate",
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
