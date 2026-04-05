import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { details } from "./hardcover";

export const manifest = defineManifest({
	kind: "provider",
	name: "Hardcover Company Details",
	slug: "company.hardcover.details",
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["books.hardcoverApiKey"],
});

export default defineProvider({ manifest, operation: "details", run: details.run });
