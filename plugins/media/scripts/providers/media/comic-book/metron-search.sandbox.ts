import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { search } from "./metron";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron Search",
	slug: "comic-book.metron.search",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["comicBooks.metronUsername", "comicBooks.metronPassword"],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
