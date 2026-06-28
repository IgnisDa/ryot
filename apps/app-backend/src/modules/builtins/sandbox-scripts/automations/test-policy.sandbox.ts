import { defineManifest } from "@ryot/sandbox-sdk";
import { defineAutomationPolicy } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
	capabilities: [],
	kind: "automation",
	requiredAppConfigKeys: [],
	name: "Automation Test Policy",
	slug: "automation.test-policy",
});

export default defineAutomationPolicy({
	manifest,
	run: ({ automation }) => {
		const action = automation.source.draft.properties["testPolicyAction"];
		if (action === "skip") {
			return Promise.resolve({
				action: "skip" as const,
				reason: "Skipped by the automation test policy",
			});
		}
		if (action === "replace") {
			return Promise.resolve({
				action: "replace" as const,
				body: {
					properties: { ...automation.source.draft.properties, testPolicyAction: "replaced" },
				},
			});
		}
		return Promise.resolve({ action: "allow" as const });
	},
});
