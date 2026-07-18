import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { automationOccurrenceRecipe, executeRyotqlRecipe } from "@ryot-app/sandbox-sdk/ryotql";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

export const manifest = defineManifest({
	kind: "automation",
	name: "Signal Notification",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "automation.notification",
	capabilities: ["executeRyotql", "sendNotification"],
});

const stringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (typeof value !== "string") {
		throw new Error(`Signal property ${key} must be a string`);
	}
	return value;
};

const formatMessage = (
	signalSchemaSlug: string,
	properties: Readonly<Record<string, JsonValue>>,
) => {
	if (signalSchemaSlug === "integration.disabled") {
		return `Integration ${stringProperty(properties, "providerName")} has been disabled due to too many errors`;
	}
	throw new Error(`Unsupported signal schema: ${signalSchemaSlug}`);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		return Effect.gen(function* () {
			if (automation.source.kind !== "signal") {
				return yield* Effect.die(new Error("Signal notification requires a signal source"));
			}
			const occurrence = yield* executeRyotqlRecipe(
				host.executeRyotql,
				automationOccurrenceRecipe(automation.occurrenceId),
			);
			if (occurrence?.source.kind !== "signal") {
				return yield* Effect.die(new Error("Signal notification requires a signal source"));
			}
			yield* host.sendNotification(
				formatMessage(
					occurrence.source.signal.signalSchemaSlug,
					occurrence.source.signal.properties,
				),
			);
			return null;
		});
	},
});
