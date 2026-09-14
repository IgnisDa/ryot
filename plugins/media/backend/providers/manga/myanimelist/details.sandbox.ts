import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList Details",
	requiredSystemConfigKeys: [],
	slug: "manga.myanimelist.details",
	requiredPluginConfigKeys: ["malClientId"],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
