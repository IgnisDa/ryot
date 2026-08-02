import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "podcast.itunes.translate",
	name: "iTunes Podcast Translation",
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
