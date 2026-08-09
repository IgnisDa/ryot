import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./myanimelist";

export const manifest = defineManifest({
	kind: "provider",
	name: "MyAnimeList Details",
	slug: "manga.myanimelist.details",
	requiredPluginConfigKeys: ["malClientId"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
