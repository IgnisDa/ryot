import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB Company Search",
	slug: "company.igdb.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
