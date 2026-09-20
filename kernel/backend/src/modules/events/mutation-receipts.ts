import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationHookIdentity,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import { EventId, type UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import {
	mutationReceiptIdentity,
	MutationReceiptIdentityConflict,
} from "#modules/mutations/receipts";

import type { EventIdentityInput, UpdateEventEntityReferencesInput } from "./repository";

export const EventCreateReceiptResult = Schema.Struct({
	eventId: EventId,
	processed: Schema.Array(AutomationHookIdentity),
});
export const EventMutationReceiptResult = Schema.Struct({ eventId: Schema.NullOr(EventId) });

export const projectEventIngestionReceipt = (commandKind: string, result: unknown) =>
	commandKind === "event:create"
		? Schema.decodeUnknownEffect(EventCreateReceiptResult)(result).pipe(
				Effect.as("created" as const),
			)
		: Effect.succeed(null);

export const eventCreateBatchInput = (input: {
	command: LifecycleCommand;
	payload: ReadonlyArray<CreateEventItem>;
	itemIdentities?: ReadonlyArray<string> | undefined;
}) => ({
	identity: ["events"],
	command: input.command,
	resource: "event" as const,
	commandInput: { payload: input.payload, itemIdentities: input.itemIdentities ?? null },
});

export const eventCreateItemCommand = (
	command: LifecycleCommand,
	index: number,
	itemIdentity?: string,
): LifecycleCommand => ({
	...command,
	itemIdentity: itemIdentity ?? `${command.itemIdentity}:event:${index}`,
});

export const eventCreateReceiptIdentity = (
	input: {
		userId: UserId;
		command: LifecycleCommand;
		itemIdentities?: ReadonlyArray<string> | undefined;
	},
	index: number,
	submittedItem: CreateEventItem,
) =>
	mutationReceiptIdentity({
		input: submittedItem,
		ownerUserId: input.userId,
		scopeUserId: input.userId,
		commandKind: "event:create",
		command: eventCreateItemCommand(input.command, index, input.itemIdentities?.[index]),
	});

export const eventMutationReceiptIdentity = (
	input: EventIdentityInput,
	command: LifecycleCommand,
	move?: UpdateEventEntityReferencesInput,
) =>
	mutationReceiptIdentity({
		command,
		ownerUserId: input.userId,
		scopeUserId: input.userId,
		commandKind: move ? "event:update" : "event:delete",
		input: move
			? { eventId: input.eventId, mergeFrom: move.mergeFrom, mergeInto: move.mergeInto }
			: { eventId: input.eventId },
	});

export const eventReceiptError = (error: DbError | MutationReceiptIdentityConflict) =>
	error instanceof MutationReceiptIdentityConflict
		? new DbError({ message: "Conflicting event command identity" })
		: error;
