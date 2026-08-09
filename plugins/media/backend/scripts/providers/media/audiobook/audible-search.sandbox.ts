import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./audible";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible Search",
	slug: "audiobook.audible.search",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
