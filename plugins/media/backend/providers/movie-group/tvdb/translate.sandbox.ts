import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Movie Group Translate",
	slug: "movie-group.tvdb.translate",
	translationInputs: { "movie-group": [] },
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
