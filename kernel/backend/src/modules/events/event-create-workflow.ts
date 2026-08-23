import { DbError } from "@ryot-app/contract/errors";
import { AutomationOrigin } from "@ryot-app/contract/modules/automations/schemas";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateOrigin,
	EventCreateItemError,
	EventsBadRequest,
} from "@ryot-app/contract/modules/events/schemas";
import { ImportRunId, IntegrationId, UserId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import type { DurableSchema } from "#lib/infrastructure/workflow";

export const EventCreateWorkflowError = Schema.Union([
	DbError,
	EventCreateItemError,
	EventsBadRequest,
]);

export const EventCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	origin: EventCreateOrigin,
	executionId: Schema.String,
	payload: Schema.Array(CreateEventItem),
	importRunId: Schema.optional(ImportRunId),
	integrationId: Schema.optional(IntegrationId),
	lifecycleOrigin: Schema.optional(AutomationOrigin),
});

export type EventCreateWorkflowPayload = typeof EventCreateWorkflowPayload.Type;

type EventCreateWorkflowInput = Omit<EventCreateWorkflowPayload, "executionId"> & {
	executionId?: string | undefined;
};

export const EventCreateWorkflow = Workflow.make("EventCreateWorkflow", {
	idempotencyKey: ({ executionId }) => executionId,
	success: CreateEventsResponse satisfies DurableSchema,
	error: EventCreateWorkflowError satisfies DurableSchema,
	payload: EventCreateWorkflowPayload satisfies DurableSchema,
});

const withExecutionId = (input: EventCreateWorkflowInput) => ({
	...input,
	executionId: input.executionId ?? generateId(),
});

export const enqueueEventCreate = (input: EventCreateWorkflowInput) =>
	EventCreateWorkflow.execute(withExecutionId(input));
