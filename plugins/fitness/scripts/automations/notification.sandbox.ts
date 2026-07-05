import { defineAutomation } from "@ryot/sandbox-sdk/automation";
import { defineManifest, type JsonValue } from "@ryot/sandbox-sdk/core";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	capabilities: ["sendNotification"],
	name: "Fitness Signal Notification",
	slug: "automation.fitness-notification",
});

const stringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (typeof value !== "string") {
		throw new Error(`Signal property ${key} must be a string`);
	}
	return value;
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.source.kind !== "signal") {
			throw new Error("Signal notification requires a signal source");
		}
		const signal = automation.source.signal;
		if (signal.signalSchemaSlug !== "workout.created") {
			throw new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`);
		}
		return host.sendNotification(
			`Workout ${stringProperty(signal.properties, "workoutName")} was created`,
		);
	},
});
