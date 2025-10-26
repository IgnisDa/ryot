import { Activity, DurableQueue } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer, Schema } from "effect";

import { DbRunner } from "#lib/db";
import { EntityId } from "#lib/schema/brands";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { createEventsForUser, provideCreateEventsContext } from "./create-core";
import { GlobalEntityReferencedQueue } from "./durable-queues";
import { EventsRepository } from "./repository";
import { EventCreateWorkflow, EventCreateWorkflowError } from "./workflows";

const CreateEventsActivityResult = Schema.Struct({
	count: Schema.Number,
	referencedGlobalEntityIds: Schema.Array(EntityId),
});

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	Effect.gen(function* () {
		const result = yield* Activity.make({
			name: "create-events",
			error: EventCreateWorkflowError,
			success: CreateEventsActivityResult,
			execute: Effect.gen(function* () {
				const dbRunner = yield* DbRunner;
				const workflowEngine = yield* WorkflowEngine;
				const eventsRepository = yield* EventsRepository;
				const entitiesRepository = yield* EntitiesRepository;
				const eventSchemasRepository = yield* EventSchemasRepository;

				return yield* provideCreateEventsContext(createEventsForUser(payload), {
					dbRunner,
					workflowEngine,
					eventsRepository,
					entitiesRepository,
					eventSchemasRepository,
				});
			}),
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
