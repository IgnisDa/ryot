import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import type { CurrentUserValue } from "~/lib/auth";
import { DbRunner } from "~/lib/db";
import type { BadRequest, DbError, NotFound } from "~/lib/errors";
import { badRequest, notFound } from "~/lib/errors";
import { SandboxService } from "~/lib/sandbox";
import { EntitiesRepository } from "~/modules/entities/repository";
import { EventSchemasRepository } from "~/modules/event-schemas/repository";
import { SandboxRepository } from "~/modules/sandbox/repository";

import { createEventsForUser } from "./create-core";
import { EventsRepository } from "./repository";
import type { CreateEventItem, CreateEventsResponse, ListedEvent } from "./schemas";

const entityNotFoundError = "Entity not found";
const sessionEntityNotFoundError = "Session entity not found";
const listScopeRequiredError = "Either entityId or sessionEntityId is required";

type EventsServiceShape = {
	readonly list: (
		user: CurrentUserValue,
		query: { entityId?: string; sessionEntityId?: string; eventSchemaSlug?: string },
	) => Effect.Effect<ListedEvent[], BadRequest | DbError | NotFound>;
	readonly create: (
		user: CurrentUserValue,
		payload: ReadonlyArray<CreateEventItem>,
	) => Effect.Effect<CreateEventsResponse, BadRequest | DbError | NotFound>;
};

export class EventsService extends Effect.Service<EventsService>()("EventsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const sandbox = yield* SandboxService;
		const repository = yield* EventsRepository;
		const sandboxRepository = yield* SandboxRepository;
		const entitiesRepository = yield* EntitiesRepository;
		const eventSchemasRepository = yield* EventSchemasRepository;

		const requireReadableEntity = (userId: string, entityId: string, notFoundMessage: string) =>
			Effect.gen(function* () {
				const scope = yield* runWithDb(
					entitiesRepository.getEntityScopeForUser({ userId, entityId }),
				);
				if (!scope) {
					return yield* notFound(notFoundMessage);
				}

				return scope;
			});

		return {
			list: (user, query) =>
				Effect.gen(function* () {
					if (!query.entityId && !query.sessionEntityId) {
						return yield* badRequest(listScopeRequiredError);
					}

					if (query.entityId) {
						yield* requireReadableEntity(user.id, query.entityId, entityNotFoundError);
					}

					if (query.sessionEntityId) {
						yield* requireReadableEntity(
							user.id,
							query.sessionEntityId,
							sessionEntityNotFoundError,
						);
					}

					return yield* runWithDb(repository.listForUser({ userId: user.id, ...query }));
				}),
			create: (user, payload) =>
				createEventsForUser(
					{
						runWithDb,
						sandboxRepository,
						entitiesRepository,
						eventSchemasRepository,
						workflowEngine: engine,
						eventsRepository: repository,
						runSandboxScript: (sandboxInput) => sandbox.run(sandboxInput),
					},
					{ userId: user.id, origin: "api", payload },
				),
		} satisfies EventsServiceShape;
	}),
}) {}
