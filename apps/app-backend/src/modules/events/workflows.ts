import { Workflow } from "@effect/workflow";
import { generateId } from "better-auth";
import { Schema } from "effect";

import { BadRequest, DbError, NotFound } from "#lib/errors";
import { ImportRunId, IntegrationId, UserId } from "#lib/schema/brands";

import { CreateEventItem, CreateEventsResponse, EventCreateOrigin } from "./schemas";

const EventCreateWorkflowError = Schema.Union(BadRequest, DbError, NotFound);

const EventCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	origin: EventCreateOrigin,
	executionId: Schema.String,
	payload: Schema.Array(CreateEventItem),
	importRunId: Schema.optional(ImportRunId),
	integrationId: Schema.optional(IntegrationId),
});

type EventCreateWorkflowInput = Omit<typeof EventCreateWorkflowPayload.Type, "executionId"> & {
	executionId?: string;
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
