import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Person Search",
	slug: "person.hardcover.search",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["books.hardcoverApiKey"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
