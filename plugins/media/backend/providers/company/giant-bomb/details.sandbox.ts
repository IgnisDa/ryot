import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "GiantBomb Company Details",
	slug: "company.giant-bomb.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
