import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "movie.tvdb.translate",
	name: "TVDB Movie Translation",
	translationInputs: { movie: [] },
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
