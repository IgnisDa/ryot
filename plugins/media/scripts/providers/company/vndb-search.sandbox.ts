import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./vndb";

export const manifest = defineManifest({
	kind: "provider",
	name: "VNDB Company Search",
	slug: "company.vndb.search",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
