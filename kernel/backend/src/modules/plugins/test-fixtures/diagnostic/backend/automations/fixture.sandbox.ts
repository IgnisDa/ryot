import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Fixture Automation",
	slug: "fixture.automation",
});

const invalid: string = 42;

export default defineAutomation({ manifest, run: () => Effect.succeed(invalid) });
