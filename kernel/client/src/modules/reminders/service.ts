import type { ContractRequest } from "@ryot-app/contract/client";
import type {
	ReminderCommandResult,
	ReminderDeliveryConfiguration,
} from "@ryot-app/contract/modules/reminders/schemas";
import type { NotificationSubscriptionId } from "@ryot-app/contract/schema/brands";
import { SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import { createRyotMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	reminderDeliveriesRecipe,
	type ReminderDeliveriesResult,
} from "@ryot-app/ryotql-recipes/notification-delivery";
import {
	reminderReadinessRecipe,
	type ReminderReadinessResult,
	remindersRecipe,
	type RemindersResult,
} from "@ryot-app/ryotql-recipes/reminders";
import { Data, Effect } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { AutomationsApi } from "#/api/automations";
import { RemindersApi } from "#/api/reminders";
import type { KernelHostServices } from "#/host-services";

export class RemindersLoadError extends Data.TaggedError("RemindersLoadError")<{
	readonly cause: unknown;
}> {}

export const remindersQuery = createRyotQuery<
	Parameters<typeof remindersRecipe>[0],
	RemindersResult,
	KernelHostServices,
	RemindersLoadError
>(
	({ input, client }) =>
		client.data
			.query(remindersRecipe(input))
			.pipe(Effect.mapError((cause) => new RemindersLoadError({ cause }))),
	{ cancelOnUnmount: true },
);

export const reminderReadinessQuery = createRyotQuery<
	void,
	{
		readonly channels: ReminderReadinessResult;
		readonly configuration: ReminderDeliveryConfiguration;
	},
	KernelHostServices,
	RemindersLoadError
>(
	({ client, hostServices }) =>
		Effect.all(
			{
				channels: client.data.query(reminderReadinessRecipe()),
				configuration: hostServices.runtime
					.runSync(RemindersApi)
					.deliveryConfiguration(hostServices.scope),
			},
			{ concurrency: 2 },
		).pipe(Effect.mapError((cause) => new RemindersLoadError({ cause }))),
	{ cancelOnUnmount: true },
);

export const reminderDeliveriesQuery = createRyotQuery<
	Parameters<typeof reminderDeliveriesRecipe>[0],
	ReminderDeliveriesResult
>(({ input, client }) => client.data.query(reminderDeliveriesRecipe(input)), {
	cancelOnUnmount: true,
});

export const reminderSubscriptionMutation = createRyotMutation<
	{ readonly enable: boolean; readonly id: null | NotificationSubscriptionId },
	void,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) => {
	const api = hostServices.runtime.runSync(AutomationsApi);
	let command: Effect.Effect<unknown, AuthenticatedApiError>;
	if (input.id === null) {
		command = api.installRule(hostServices.scope, {
			payload: {
				signalSchema: { owner: { kind: "kernel" }, slug: SignalSchemaSlug.make("reminder.due") },
			},
		});
	} else if (input.enable) {
		command = api.activateRule(hostServices.scope, { params: { ruleId: input.id } });
	} else {
		command = api.deactivateRule(hostServices.scope, { params: { ruleId: input.id } });
	}
	return command.pipe(
		Effect.tap(() => Effect.sync(client.mutationCompleted.hint)),
		Effect.asVoid,
	);
});

export type ReminderCommand = {
	[Action in "edit" | "create" | "cancel" | "remove"]: {
		readonly action: Action;
		readonly request: ContractRequest<"reminders", Action>;
	};
}["edit" | "create" | "cancel" | "remove"];

export const reminderCommandMutation = createRyotMutation<
	ReminderCommand,
	ReminderCommandResult,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) => {
	const api = hostServices.runtime.runSync(RemindersApi);
	let command: Effect.Effect<ReminderCommandResult, AuthenticatedApiError>;
	switch (input.action) {
		case "edit":
			command = api.edit(hostServices.scope, input.request);
			break;
		case "create":
			command = api.create(hostServices.scope, input.request);
			break;
		case "cancel":
			command = api.cancel(hostServices.scope, input.request);
			break;
		case "remove":
			command = api.remove(hostServices.scope, input.request);
			break;
	}
	return command.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint)));
});
