import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	requiredSystemConfigKeys: [],
	name: "GiantBomb Person Details",
	slug: "person.giant-bomb.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["giantBombApiKey"],
});

export default defineProvider({ manifest, run: details.run, operation: "details" });
