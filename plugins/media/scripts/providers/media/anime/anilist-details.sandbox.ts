import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./anilist";

export const manifest = defineManifest({
	name: "Anilist Details",
	kind: "provider",
	slug: "anime.anilist.details",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall", "getUserPreferences"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
