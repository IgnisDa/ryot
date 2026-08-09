import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./anilist";

export const manifest = defineManifest({
	kind: "provider",
	name: "Anilist Company Search",
	slug: "company.anilist.search",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
