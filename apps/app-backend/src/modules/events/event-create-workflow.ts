import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateOrigin,
} from "@ryot/contract/modules/events/schemas";
import { ImportRunId, IntegrationId, UserId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { withoutSchemaServices } from "#lib/shared/schema";

export const EventCreateWorkflowError = Schema.Union([BadRequest, DbError, NotFound]);

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
	success: withoutSchemaServices(CreateEventsResponse),
	error: withoutSchemaServices(EventCreateWorkflowError),
	payload: withoutSchemaServices(EventCreateWorkflowPayload),
	idempotencyKey: ({ executionId }) => executionId,
});

const withExecutionId = (input: EventCreateWorkflowInput) => ({
	...input,
	executionId: input.executionId ?? generateId(),
});

export const enqueueEventCreate = (input: EventCreateWorkflowInput) =>
	EventCreateWorkflow.execute(withExecutionId(input));
