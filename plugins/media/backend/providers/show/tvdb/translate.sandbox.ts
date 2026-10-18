import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "show.tvdb.translate",
	name: "TVDB Show Translation",
	translationInputs: {
		show: [],
		"show-season": ["parentShowExternalId"],
		"show-episode": ["parentShowExternalId"],
	},
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
