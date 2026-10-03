import { DbError } from "@ryot-app/contract/errors";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateItemError,
} from "@ryot-app/contract/modules/events/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import type { DurableSchema } from "#lib/infrastructure/workflow";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

export const EventCreateWorkflowError = Schema.Union([DbError, EventCreateItemError]);
export const EventCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	command: LifecycleCommand,
	payload: Schema.Array(CreateEventItem),
	itemIdentities: Schema.optional(Schema.Array(Schema.NonEmptyString)),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(input) =>
				input.itemIdentities === undefined ||
				(input.itemIdentities.length === input.payload.length &&
					new Set(input.itemIdentities).size === input.itemIdentities.length) ||
				"Event operation identities must be unique and match the event payload",
		),
	),
);
export type EventCreateWorkflowPayload = typeof EventCreateWorkflowPayload.Type;

export const EventCreateWorkflow = Workflow.make("EventCreateWorkflow", {
	success: CreateEventsResponse satisfies DurableSchema,
	error: EventCreateWorkflowError satisfies DurableSchema,
	payload: EventCreateWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ command }) =>
		sha256Base64Url(
			stableStringify([
				command.causation.executionId,
				command.itemIdentity,
				command.accountGeneration,
			]),
		),
});

export const enqueueEventCreate = Effect.fn("enqueueEventCreate")(function* (
	input: EventCreateWorkflowPayload,
) {
	const receipts = yield* MutationReceipts.make;
	const engine = yield* WorkflowEngine;
	return yield* dispatchAdmittedWorkflow(
		receipts,
		engine,
		EventCreateWorkflow,
		input.command.accountGeneration,
		{ payload: input },
		(admission) => admission,
		(execution) => execution,
	);
});
