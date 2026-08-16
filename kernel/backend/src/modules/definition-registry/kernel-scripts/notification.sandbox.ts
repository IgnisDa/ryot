import { defineAutomation } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";

export const manifest = defineManifest({
	kind: "automation",
	name: "Signal Notification",
	automationType: "automation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "automation.notification",
	capabilities: ["sendNotification"],
	inputProjection: { signal: { properties: ["providerName"] } },
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
			if (automation.payload.resource !== "signal") {
				return yield* Effect.die(new Error("Signal notification requires a signal source"));
			}
			if (automation.executionUserId === null) {
				return yield* Effect.die(new Error("Signal notification requires an execution user"));
			}
			yield* host.sendNotification(
				formatMessage(automation.payload.signalSchemaSlug, automation.payload.properties),
			);
			return null;
		});
	},
});
