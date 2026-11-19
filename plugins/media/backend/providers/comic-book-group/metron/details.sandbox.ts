import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron Comic Book Group Details",
	slug: "comic-book-group.metron.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
