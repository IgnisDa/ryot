import { Workflow } from "@effect/workflow";
import { generateId } from "better-auth";
import { Schema } from "effect";

import { BadRequest, DbError, NotFound } from "#lib/errors";

import { CreateEventItem, CreateEventsResponse, EventCreateOrigin } from "./schemas";

export const EventCreateWorkflowError = Schema.Union(BadRequest, DbError, NotFound);

export const EventCreateWorkflowPayload = Schema.Struct({
	userId: Schema.String,
	origin: EventCreateOrigin,
	executionId: Schema.String,
	payload: Schema.Array(CreateEventItem),
	importRunId: Schema.optional(Schema.String),
	integrationId: Schema.optional(Schema.String),
});

type EventCreateWorkflowInput = Omit<typeof EventCreateWorkflowPayload.Type, "executionId">;

export const EventCreateWorkflow = Workflow.make({
	name: "EventCreateWorkflow",
	success: CreateEventsResponse,
	error: EventCreateWorkflowError,
	payload: EventCreateWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const withExecutionId = (input: EventCreateWorkflowInput) => ({
	...input,
	executionId: generateId(),
});

export const enqueueEventCreate = (input: EventCreateWorkflowInput) =>
	EventCreateWorkflow.execute(withExecutionId(input), { discard: true });

export const runEventCreate = (input: EventCreateWorkflowInput) =>
	EventCreateWorkflow.execute(withExecutionId(input));
