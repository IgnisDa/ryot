import * as PersistedQueue from "@effect/experimental/PersistedQueue";
import { Activity, DurableQueue } from "@effect/workflow";
import type { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { DbError } from "@ryot/contract/errors";
import { EntityId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { GlobalEntityReferencedQueue } from "./durable-queues";
import {
	EventCreateWorkflow,
	EventCreateWorkflowError,
	type EventCreateWorkflowPayload,
} from "./event-create-workflow";
import { createEventsForUser } from "./event-creation";

const EventCreateResult = Schema.Struct({
	count: Schema.Number,
	referencedGlobalEntityIds: Schema.Array(EntityId),
});

type GlobalReferenceInput = {
	userId: EventCreateWorkflowPayload["userId"];
	entityId: EntityId;
	executionId: string;
};

export type EventCreateWorkflowOperationsValue = {
	processGlobalReference: (
		input: GlobalReferenceInput,
	) => Effect.Effect<void, DbError, WorkflowEngine | WorkflowInstance>;
};

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
				processGlobalReference: (input) =>
					DurableQueue.process(GlobalEntityReferencedQueue, input).pipe(
						Effect.asVoid,
						Effect.provideService(PersistedQueue.PersistedQueueFactory, queueFactory),
					),
			}) satisfies EventCreateWorkflowOperationsValue,
	),
);

export const runEventCreateWorkflow = Effect.fn("runEventCreateWorkflow")(function* (
	payload: EventCreateWorkflowPayload,
) {
	const operations = yield* EventCreateWorkflowOperations;
	const result = yield* Activity.make({
		success: EventCreateResult,
		name: "create-events-for-user",
		error: EventCreateWorkflowError,
		execute: createEventsForUser(payload),
	});

	yield* Effect.forEach(
		result.referencedGlobalEntityIds,
		(entityId) =>
			operations.processGlobalReference({
				entityId,
				userId: payload.userId,
				executionId: `${payload.executionId}-libref-${entityId}`,
			}),
		{ discard: true },
	);

	return { count: result.count };
});

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	runEventCreateWorkflow(payload),
);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
