import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Translate",
	slug: "show.tmdb.translate",
	translationInputs: {
		show: [],
		"show-season": ["parentShowExternalId", "seasonNumber"],
		"show-episode": ["parentShowExternalId", "seasonNumber", "episodeNumber"],
	},
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
