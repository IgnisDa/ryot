import { Activity } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { DbRunner } from "#lib/db";
import { SandboxService } from "#lib/sandbox";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { SandboxRepository } from "#modules/sandbox/repository";

import { createEventsForUser, provideCreateEventsContext } from "./create-core";
import { GlobalEntityHook } from "./global-entity-hook";
import { EventsRepository } from "./repository";
import { CreateEventsResponse } from "./schemas";
import { EventCreateWorkflow, EventCreateWorkflowError } from "./workflows";

const EventCreateWorkflowLive = EventCreateWorkflow.toLayer((payload) =>
	Activity.make({
		name: "create-events",
		success: CreateEventsResponse,
		error: EventCreateWorkflowError,
		execute: Effect.gen(function* () {
			const dbRunner = yield* DbRunner;
			const sandbox = yield* SandboxService;
			const workflowEngine = yield* WorkflowEngine;
			const eventsRepository = yield* EventsRepository;
			const { onGlobalEntity } = yield* GlobalEntityHook;
			const entitiesRepository = yield* EntitiesRepository;
			const sandboxRepository = yield* SandboxRepository;
			const eventSchemasRepository = yield* EventSchemasRepository;

			return yield* provideCreateEventsContext(
				createEventsForUser(payload, sandbox.run, onGlobalEntity),
				{
					dbRunner,
					workflowEngine,
					eventsRepository,
					sandboxRepository,
					entitiesRepository,
					eventSchemasRepository,
				},
			);
		}),
	}),
);

export const EventCreateWorkflowDefinitionsLive = Layer.mergeAll(EventCreateWorkflowLive);
