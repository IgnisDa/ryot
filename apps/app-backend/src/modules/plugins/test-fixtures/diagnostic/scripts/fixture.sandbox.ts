import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/core";

export const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	requiredAppConfigKeys: [],
	name: "Fixture Automation",
	slug: "fixture.automation",
});

const invalid: string = 42;

export default defineAutomation({ manifest, run: () => Promise.resolve(invalid) });
