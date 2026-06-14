import { Workflow } from "@effect/workflow";
import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateOrigin,
} from "@ryot/contract/modules/events/schemas";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Schema } from "effect";

export const EventCreateWorkflowError = Schema.Union(BadRequest, DbError, NotFound);

export const EventCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	origin: EventCreateOrigin,
	executionId: Schema.String,
	payload: Schema.Array(CreateEventItem),
	importRunId: Schema.optional(ImportRunId),
	integrationId: Schema.optional(IntegrationId),
});

export type EventCreateWorkflowPayload = typeof EventCreateWorkflowPayload.Type;

type EventCreateWorkflowInput = Omit<EventCreateWorkflowPayload, "executionId"> & {
	executionId?: string | undefined;
};

export const EventCreateWorkflow = Workflow.make({
	name: "EventCreateWorkflow",
	success: CreateEventsResponse,
	error: EventCreateWorkflowError,
	payload: EventCreateWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const withExecutionId = (input: EventCreateWorkflowInput) => ({
	...input,
	executionId: input.executionId ?? generateId(),
});

export const enqueueEventCreate = (input: EventCreateWorkflowInput) =>
	EventCreateWorkflow.execute(withExecutionId(input), { discard: true });
