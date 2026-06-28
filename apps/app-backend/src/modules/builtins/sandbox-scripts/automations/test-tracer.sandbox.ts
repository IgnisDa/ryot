import { defineManifest } from "@ryot/sandbox-sdk";
import { defineAutomation } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	requiredAppConfigKeys: [],
	slug: "automation.test-tracer",
	name: "Automation Test Tracer",
});

export default defineAutomation({
	manifest,
	run: ({ automation }) =>
		Promise.resolve({
			ruleId: automation.ruleId,
			occurrenceId: automation.occurrenceId,
		}),
});
