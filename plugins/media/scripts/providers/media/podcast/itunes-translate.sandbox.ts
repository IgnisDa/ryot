import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { translate } from "./itunes";

export const manifest = defineManifest({
	kind: "provider",
	name: "iTunes Podcast Translation",
	slug: "podcast.itunes.translate",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "translate", run: translate.run });
