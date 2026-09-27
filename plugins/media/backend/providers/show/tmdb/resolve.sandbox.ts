import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { resolve } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "TMDB Show Resolve",
	slug: "show.tmdb.resolve",
});

export default defineProvider({ manifest, run: resolve.run, operation: "resolve" });
