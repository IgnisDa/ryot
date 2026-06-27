import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Company Search",
	slug: "company.giant-bomb.search",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "search", run: search.run });
