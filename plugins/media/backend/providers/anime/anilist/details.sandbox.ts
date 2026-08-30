import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Details",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "anime.anilist.details",
	capabilities: ["httpCall", "getUserPreferences"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
