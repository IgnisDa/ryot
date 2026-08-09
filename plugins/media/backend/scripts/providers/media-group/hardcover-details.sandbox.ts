import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Book Group Details",
	slug: "book-group.hardcover.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
