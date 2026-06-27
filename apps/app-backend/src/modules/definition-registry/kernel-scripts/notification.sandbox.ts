import { defineAutomation, type AutomationSignalSnapshot } from "@ryot/sandbox-sdk/automation";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	name: "Signal Notification",
	slug: "automation.notification",
	capabilities: ["sendNotification"],
});

const stringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (typeof value !== "string") {
		throw new Error(`Signal property ${key} must be a string`);
	}
	return value;
};

const formatMessage = (signal: AutomationSignalSnapshot) => {
	if (signal.signalSchemaSlug === "integration.disabled") {
		return `Integration ${stringProperty(signal.properties, "providerName")} has been disabled due to too many errors`;
	}
	throw new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		return Effect.gen(function* () {
			if (automation.source.kind !== "signal") {
				return yield* Effect.dieMessage("Signal notification requires a signal source");
			}
			yield* host.sendNotification(formatMessage(automation.source.signal));
			return null;
		});
	},
});
