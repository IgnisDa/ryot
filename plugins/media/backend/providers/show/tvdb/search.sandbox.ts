import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TVDB Show Search",
	slug: "show.tvdb.search",
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
