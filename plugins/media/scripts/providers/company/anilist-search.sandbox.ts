import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./anilist";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Company Search",
	slug: "company.anilist.search",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
