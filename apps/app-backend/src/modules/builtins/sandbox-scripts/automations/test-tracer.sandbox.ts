import { defineManifest } from "@ryot/sandbox-sdk";
import { defineAutomation } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	capabilities: ["emitSignal"],
	slug: "automation.test-tracer",
	name: "Automation Test Tracer",
});

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		const message =
			automation.source.kind === "signal" &&
			typeof automation.source.signal.properties["message"] === "string"
				? automation.source.signal.properties["message"]
				: "trace";
		return host.emitSignal({
			properties: { message },
			schemaSlug: "automation.test-emitted",
			discriminator: automation.occurrenceId,
		});
	},
});
