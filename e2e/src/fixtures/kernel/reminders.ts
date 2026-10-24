import type { ContractPayload } from "@ryot-app/contract/client";
import { ReminderId } from "@ryot-app/contract/schema/brands";
import { remindersRecipe } from "@ryot-app/ryotql-recipes/reminders";
import { DateTime, Effect } from "effect";

import type { Client } from "./auth";
import { executeRyotQLRecipe } from "./ryotql";

export const reminderSubmission = Effect.gen(function* () {
	return {
		idempotencyKey: crypto.randomUUID(),
		submittedAt: DateTime.formatIso(yield* DateTime.now),
	};
});

export const createReminder = (client: Client, payload: ContractPayload<"reminders", "create">) =>
	client.call((c) => c.reminders.create({ payload }));

export const editReminder = (
	client: Client,
	id: string,
	payload: ContractPayload<"reminders", "edit">,
) => client.call((c) => c.reminders.edit({ payload, params: { reminderId: ReminderId.make(id) } }));

export const cancelReminder = (
	client: Client,
	id: string,
	payload: ContractPayload<"reminders", "cancel">,
) =>
	client.call((c) => c.reminders.cancel({ payload, params: { reminderId: ReminderId.make(id) } }));

export const removeReminder = (
	client: Client,
	id: string,
	payload: ContractPayload<"reminders", "remove">,
) =>
	client.call((c) => c.reminders.remove({ payload, params: { reminderId: ReminderId.make(id) } }));

export const listReminders = (client: Client) =>
	executeRyotQLRecipe(
		client,
		remindersRecipe({
			limit: 100,
			states: ["scheduled", "processing", "needs-scheduling", "settled", "cancelled"],
		}),
	);

export const runReminderScan = (client: Client) =>
	client.adminCall((c) => c.testSupport.runReminderScan());
