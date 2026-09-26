import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Person Translate",
	slug: "person.tmdb.translate",
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	capabilities: ["httpCall", "getPluginConfig", "getUserSettings"],
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
