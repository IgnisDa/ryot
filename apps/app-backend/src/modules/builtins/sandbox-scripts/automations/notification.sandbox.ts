import { defineManifest, type JsonValue } from "@ryot/sandbox-sdk";
import { defineAutomation, type AutomationSignalSnapshot } from "@ryot/sandbox-sdk/automation";

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
	if (signal.signalSchemaSlug === "review.created") {
		return `Review posted for ${stringProperty(signal.properties, "entityName")}`;
	}
	if (signal.signalSchemaSlug === "workout.created") {
		return `Workout ${stringProperty(signal.properties, "workoutName")} was created`;
	}
	if (signal.signalSchemaSlug === "integration.disabled") {
		return `Integration ${stringProperty(signal.properties, "providerName")} has been disabled due to too many errors`;
	}
	throw new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.source.kind !== "signal") {
			throw new Error("Signal notification requires a signal source");
		}
		return host.sendNotification(formatMessage(automation.source.signal));
	},
});
