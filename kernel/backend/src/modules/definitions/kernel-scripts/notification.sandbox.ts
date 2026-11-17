import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { isMessage } from "@ryot-app/plugin-kit/messages";

import { catalogMessage } from "./shared/messages.generated";

export const manifest = defineManifest({
	kind: "automation",
	name: "Signal Notification",
	automationType: "automation",
	slug: "automation.notification",
	inputProjection: {
		signal: { properties: ["providerName", "message", "entityTitle", "dueAt", "timezone"] },
	},
});

const stringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (typeof value !== "string") {
		throw new Error(`Signal property ${key} must be a string`);
	}
	return value;
};

/** The kernel stamps its own namespace only on local messages, so a stamped definition name passes through. */
const messageProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (!isMessage(value)) {
		throw new Error(`Signal property ${key} must be a message`);
	}
	return value;
};

const notificationMessage = (
	signalSchemaSlug: string,
	properties: Readonly<Record<string, JsonValue>>,
) => {
	if (signalSchemaSlug === "integration.disabled") {
		return catalogMessage("notification.integration-disabled", {
			provider: messageProperty(properties, "providerName"),
		});
	}
	if (signalSchemaSlug === "reminder.due") {
		const timeZone = stringProperty(properties, "timezone");
		return catalogMessage("notification.reminder-due", {
			timeZone,
			message: stringProperty(properties, "message"),
			entityTitle: stringProperty(properties, "entityTitle"),
			dueAt: { timeZone, date: new Date(stringProperty(properties, "dueAt")) },
		});
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
				notificationMessage(automation.payload.signalSchemaSlug, automation.payload.properties),
			);
			return null;
		});
	},
});
