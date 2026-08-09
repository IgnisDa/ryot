import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./audible";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible Person Search",
	slug: "person.audible.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
