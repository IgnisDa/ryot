import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "show.tvdb.translate",
	name: "TVDB Show Translation",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
