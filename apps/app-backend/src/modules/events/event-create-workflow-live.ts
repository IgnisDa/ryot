import { DurableQueue } from "@effect/workflow";
import { Effect, Layer } from "effect";

import { GlobalEntityReferencedQueue } from "./durable-queues";
import { EventCreateWorkflow } from "./event-create-workflow";
import { createEventsForUser } from "./event-creation";

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
