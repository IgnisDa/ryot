import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	name: "Fixture Automation",
	slug: "fixture.automation",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	inputProjection: {
		signal: { properties: [] },
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

export default defineAutomation({ manifest, run: () => Effect.succeed(null) });
