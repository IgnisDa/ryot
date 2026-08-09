import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Details",
	requiredSystemConfigKeys: [],
	slug: "book.hardcover.details",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
