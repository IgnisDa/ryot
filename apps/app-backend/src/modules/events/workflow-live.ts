import { DurableQueue } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { DbRunner } from "#lib/db";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { createEventsForUser, provideCreateEventsContext } from "./create-core";
import { GlobalEntityReferencedQueue } from "./durable-queues";
import { EventsRepository } from "./repository";
import { EventCreateWorkflow } from "./workflows";

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	Effect.gen(function* () {
		const dbRunner = yield* DbRunner;
		const workflowEngine = yield* WorkflowEngine;
		const eventsRepository = yield* EventsRepository;
		const entitiesRepository = yield* EntitiesRepository;
		const eventSchemasRepository = yield* EventSchemasRepository;

		const result = yield* provideCreateEventsContext(createEventsForUser(payload), {
			dbRunner,
			workflowEngine,
			eventsRepository,
			entitiesRepository,
			eventSchemasRepository,
		});

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
