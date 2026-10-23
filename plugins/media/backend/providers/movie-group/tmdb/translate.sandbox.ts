import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Movie Group Translate",
	slug: "movie-group.tmdb.translate",
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
