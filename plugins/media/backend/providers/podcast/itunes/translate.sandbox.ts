import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	slug: "podcast.itunes.translate",
	name: "iTunes Podcast Translation",
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
