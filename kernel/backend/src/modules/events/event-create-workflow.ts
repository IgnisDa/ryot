import { DbError } from "@ryot-app/contract/errors";
import {
	CreateEventItem,
	CreateEventsResponse,
	EventCreateItemError,
} from "@ryot-app/contract/modules/events/schemas";
import { UserId } from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";

import { LifecycleCommand } from "#lib/domain/lifecycle-command";
import type { DurableSchema } from "#lib/infrastructure/workflow";

export const EventCreateWorkflowError = Schema.Union([DbError, EventCreateItemError]);
export const EventCreateWorkflowPayload = Schema.Struct({
	userId: UserId,
	command: LifecycleCommand,
	payload: Schema.Array(CreateEventItem),
});
export type EventCreateWorkflowPayload = typeof EventCreateWorkflowPayload.Type;

export const EventCreateWorkflow = Workflow.make("EventCreateWorkflow", {
	success: CreateEventsResponse satisfies DurableSchema,
	error: EventCreateWorkflowError satisfies DurableSchema,
	payload: EventCreateWorkflowPayload satisfies DurableSchema,
	idempotencyKey: ({ command }) =>
		sha256Base64Url(stableStringify([command.causation.executionId, command.itemIdentity])),
});

export const enqueueEventCreate = (input: EventCreateWorkflowPayload) =>
	EventCreateWorkflow.execute(input);
