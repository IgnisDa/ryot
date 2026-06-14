import { DurableQueue } from "@effect/workflow";
import { Effect, Layer } from "effect";

import { createEventsForUser } from "./create-core";
import { GlobalEntityReferencedQueue } from "./durable-queues";
import { EventCreateWorkflow } from "./workflows";

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	Effect.gen(function* () {
		const result = yield* createEventsForUser(payload);

		yield* Effect.forEach(
			result.referencedGlobalEntityIds,
			(entityId) =>
				DurableQueue.process(GlobalEntityReferencedQueue, {
					entityId,
					userId: payload.userId,
					executionId: `${payload.executionId}-libref-${entityId}`,
				}),
			{ discard: true },
		);

		return { count: result.count };
	}),
);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
