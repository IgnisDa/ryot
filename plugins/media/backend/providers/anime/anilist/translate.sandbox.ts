import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	name: "Anilist Translate",
	kind: "provider",
	slug: "anime.anilist.translate",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
