import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { related } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron Comic Book Group Related",
	slug: "comic-book-group.metron.related",
});

export default defineProvider({ manifest, run: related.run, operation: "related" });
