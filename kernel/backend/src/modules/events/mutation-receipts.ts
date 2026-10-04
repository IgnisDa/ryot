import { DbError } from "@ryot-app/contract/errors";
import { AutomationHookIdentity } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventCreateItemError,
	type CreateEventItem,
	type UpdateEventItem,
} from "@ryot-app/contract/modules/events/schemas";
import { EventId, type UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import {
	mutationReceiptIdentity,
	MutationReceiptIdentityConflict,
} from "#modules/mutations/receipts";

import type { EventCreateWorkflowPayload } from "./event-create-workflow";
import type { EventIdentityInput, UpdateEventEntityReferencesInput } from "./repository";

export const EventCreateReceiptResult = Schema.Struct({
	eventId: EventId,
	processed: Schema.Array(AutomationHookIdentity),
});
export const EventMutationReceiptResult = Schema.Struct({ eventId: Schema.NullOr(EventId) });
export const EventMutationBatchReceiptResult = Schema.Struct({
	eventIds: Schema.Array(Schema.NullOr(EventId)),
});

export const projectEventIngestionReceipt = (commandKind: string, result: unknown) =>
	commandKind === "event:create"
		? Schema.decodeUnknownEffect(EventCreateReceiptResult)(result).pipe(
				Effect.as("created" as const),
			)
		: Effect.succeed(null);

export const eventCreateBatchInput = (input: {
	command: DomainLifecycleCommand;
	payload: ReadonlyArray<CreateEventItem>;
	itemIdentities?: ReadonlyArray<string> | undefined;
}) => ({
	identity: ["events"],
	command: input.command,
	resource: "event" as const,
	commandInput: {
		payload: input.payload,
		writeContext: input.command.writeContext,
		itemIdentities: input.itemIdentities ?? null,
	},
});

export const eventCreateWriteCommand = (
	payload: EventCreateWorkflowPayload,
	index: number,
): DomainLifecycleCommand => {
	const command = payload.writeCommand ?? payload.command;
	return {
		...command,
		itemIdentity: payload.itemIdentities?.[index] ?? `${command.itemIdentity}:event:${index}`,
	};
};

export const eventCreateReceiptIdentity = (
	input: EventCreateWorkflowPayload,
	index: number,
	submittedItem: CreateEventItem,
) =>
	mutationReceiptIdentity({
		ownerUserId: input.userId,
		scopeUserId: input.userId,
		commandKind: "event:create",
		command: eventCreateWriteCommand(input, index),
		input: {
			item: submittedItem,
			writeContext: input.command.writeContext,
			...(input.writeCommand ? { payload: input.payload } : {}),
		},
	});

export const eventMutationReceiptIdentity = (
	input: EventIdentityInput,
	command: DomainLifecycleCommand,
	mutation:
		| { readonly operation: "delete" }
		| { readonly operation: "edit"; readonly submitted: UpdateEventItem }
		| { readonly operation: "move"; readonly move: UpdateEventEntityReferencesInput },
) => {
	let commandKind: string;
	let receiptInput: unknown;
	if (mutation.operation === "edit") {
		commandKind = "event:edit";
		receiptInput = mutation.submitted;
	} else if (mutation.operation === "move") {
		commandKind = "event:update";
		receiptInput = {
			eventId: input.eventId,
			mergeFrom: mutation.move.mergeFrom,
			mergeInto: mutation.move.mergeInto,
		};
	} else {
		commandKind = "event:delete";
		receiptInput = { eventId: input.eventId };
	}
	return mutationReceiptIdentity({
		command,
		commandKind,
		ownerUserId: input.userId,
		scopeUserId: input.userId,
		input: { mutation: receiptInput, writeContext: command.writeContext },
	});
};

export const eventMutationBatchReceiptIdentity = (input: {
	userId: UserId;
	command: DomainLifecycleCommand;
	operation: "delete" | "edit";
	submitted: unknown;
}) =>
	mutationReceiptIdentity({
		command: input.command,
		ownerUserId: input.userId,
		scopeUserId: input.userId,
		input: { items: input.submitted, writeContext: input.command.writeContext },
		commandKind: input.operation === "edit" ? "event:edit-batch" : "event:delete-batch",
	});

export const eventReceiptError = (error: DbError | MutationReceiptIdentityConflict) =>
	error instanceof MutationReceiptIdentityConflict
		? new DbError({ message: "Conflicting event command identity" })
		: error;

export const eventCreateReceiptError = (error: DbError | MutationReceiptIdentityConflict) =>
	error instanceof MutationReceiptIdentityConflict
		? new EventCreateItemError({ reason: { code: "mutation-conflict" } })
		: error;
