import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Company Details",
	slug: "company.tmdb.details",
	capabilities: ["httpCall", "getPluginConfig"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
