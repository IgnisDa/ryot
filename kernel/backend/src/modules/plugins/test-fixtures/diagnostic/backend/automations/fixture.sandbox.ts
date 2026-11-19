import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({
	kind: "automation",
	name: "Fixture Automation",
	slug: "fixture.automation",
	automationType: "automation",
	inputProjection: {
		signal: { properties: [] },
		entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
	},
});

const invalid: string = 42;

export default defineAutomation({ manifest, run: () => Effect.succeed(invalid) });
