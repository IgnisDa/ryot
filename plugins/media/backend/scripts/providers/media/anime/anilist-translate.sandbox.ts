import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { translate } from "./anilist";

export const manifest = defineManifest({
	name: "Anilist Translate",
	kind: "provider",
	slug: "anime.anilist.translate",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
