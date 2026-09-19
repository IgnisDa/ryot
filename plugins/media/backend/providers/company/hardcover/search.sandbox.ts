import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Company Search",
	slug: "company.hardcover.search",
	capabilities: ["httpCall", "getPluginConfig"],
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
