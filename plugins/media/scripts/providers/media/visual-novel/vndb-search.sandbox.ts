import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./vndb";

export const manifest = defineManifest({
	kind: "provider",
	name: "VNDB Visual Novel Search",
	slug: "visual-novel.vndb.search",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
