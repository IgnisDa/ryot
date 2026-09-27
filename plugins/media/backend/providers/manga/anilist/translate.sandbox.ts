import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { translate } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Translate",
	slug: "manga.anilist.translate",
});

export default defineProvider({ manifest, run: translate.run, operation: "translate" });
