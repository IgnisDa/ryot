import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/core";

export const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	requiredAppConfigKeys: [],
	name: "Fixture Automation",
	slug: "fixture.automation",
});

export default defineAutomation({ manifest, run: () => Promise.resolve(null) });
