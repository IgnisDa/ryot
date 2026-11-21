import { defineAutomation, notifySignals } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { isMessage } from "@ryot-app/plugin-kit/messages";

import { catalogMessage } from "./shared/messages.generated";

export const manifest = defineManifest({
	kind: "automation",
	name: "Signal Notification",
	automationType: "automation",
	slug: "automation.notification",
	inputProjection: {
		signal: { properties: ["providerName", "message", "entityId", "dueAt", "timezone"] },
	},
});

/** The kernel stamps its own namespace only on local messages, so a stamped definition name passes through. */
const MessageProperty = Schema.Unknown.pipe(Schema.refine(isMessage));

export default defineAutomation({
	manifest,
	run: notifySignals({
		"integration.disabled": {
			properties: Schema.Struct({ providerName: MessageProperty }),
			notify: ({ providerName }) =>
				catalogMessage("notification.integration-disabled", { provider: providerName }),
		},
		"reminder.due": {
			properties: Schema.Struct({
				dueAt: Schema.String,
				message: Schema.String,
				entityId: Schema.String,
				timezone: Schema.String,
			}),
			notify: ({ dueAt, message, entityId, timezone }) =>
				catalogMessage("notification.reminder-due", {
					message,
					timeZone: timezone,
					entityTitle: { entityId },
					dueAt: { timeZone: timezone, date: new Date(dueAt) },
				}),
		},
	}),
});
