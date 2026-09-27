import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Person Search",
	slug: "person.tvdb.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
