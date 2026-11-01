import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Company Details",
	slug: "company.tmdb.details",
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
