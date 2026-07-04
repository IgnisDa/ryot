import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./anilist";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Company Details",
	slug: "company.anilist.details",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
