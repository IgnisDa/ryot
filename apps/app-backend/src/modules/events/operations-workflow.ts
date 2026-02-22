import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError, SandboxRunError } from "@ryot/contract/errors";
import type {
	SandboxCompletedResult,
	SandboxExecutionPayload,
} from "@ryot/contract/modules/sandbox/schemas";
import type { EntityId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { EnsureLibraryMembershipQueue } from "./durable-queues";
import type { EventCreateWorkflowPayload } from "./event-create-workflow";

type EnsureLibraryMembershipInput = {
	userId: EventCreateWorkflowPayload["userId"];
	entityId: EntityId;
	executionId: string;
};

type EventCreateWorkflowOperationsValue = {
	ensureLibraryMembership: (
		input: EnsureLibraryMembershipInput,
	) => Effect.Effect<void, DbError, WorkflowEngine | WorkflowInstance>;
	processSandboxExecution: (
		payload: SandboxExecutionPayload,
	) => Effect.Effect<SandboxCompletedResult, SandboxRunError, WorkflowEngine | WorkflowInstance>;
};

/**
 * DurableQueue.process must run inside the calling workflow's own execution
 * context, so these requirements are intentional pass-throughs.
 * @effect-expect-leaking WorkflowEngine WorkflowInstance
 */
export class EventCreateWorkflowOperations extends Context.Tag("EventCreateWorkflowOperations")<
	EventCreateWorkflowOperations,
	EventCreateWorkflowOperationsValue
>() {}

export const EventCreateWorkflowOperationsLive = Layer.effect(
	EventCreateWorkflowOperations,
	Effect.map(
		PersistedQueue.PersistedQueueFactory,
		(queueFactory) =>
			({
				ensureLibraryMembership: (input) =>
					DurableQueue.process(EnsureLibraryMembershipQueue, input).pipe(
						Effect.asVoid,
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
				processSandboxExecution: (payload) =>
					DurableQueue.process(SandboxExecutionQueue, payload).pipe(
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies EventCreateWorkflowOperationsValue,
	),
);
