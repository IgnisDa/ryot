import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Translate",
	slug: "movie.tmdb.translate",
	capabilities: ["httpCall", "getPluginConfig"],
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
