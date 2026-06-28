import { defineManifest } from "@ryot/sandbox-sdk";
import { defineAutomation } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	slug: "automation.test-notifier",
	name: "Automation Test Notifier",
	capabilities: ["sendNotification"],
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const message =
			automation.source.kind === "signal" &&
			typeof automation.source.signal.properties["message"] === "string"
				? automation.source.signal.properties["message"]
				: "Automation notification";
		return host.sendNotification(message);
	},
});
