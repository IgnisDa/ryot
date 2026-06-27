import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./manga-updates";

export const manifest = defineManifest({
	kind: "provider",
	name: "MangaUpdates Person Details",
	slug: "person.manga-updates.details",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
