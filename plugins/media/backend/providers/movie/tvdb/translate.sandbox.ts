import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "movie.tvdb.translate",
	name: "TVDB Movie Translation",
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfig"],
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
