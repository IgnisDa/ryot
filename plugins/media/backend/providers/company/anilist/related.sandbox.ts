import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { related } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Company Related",
	slug: "company.anilist.related",
});

export default defineProvider({ manifest, run: related.run, operation: "related" });
