import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import type { EntityId, ImportRunId, IntegrationId, UserId } from "#lib/schema/brands";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { validateEventCreateSubmission } from "./create-core";
import { EventsRepository } from "./repository";
import type { CreateEventItem, EventCreateOrigin } from "./schemas";
import { enqueueEventCreate } from "./workflows";

const entityNotFoundError = "Entity not found";
const sessionEntityNotFoundError = "Session entity not found";
const listScopeRequiredError = "Either entityId or sessionEntityId is required";

type EventCreateInput = {
	readonly userId: UserId;
	readonly executionId?: string;
	readonly source: EventCreateOrigin;
	readonly payload: ReadonlyArray<CreateEventItem>;
	readonly metadata?: {
		readonly importRunId?: ImportRunId;
		readonly integrationId?: IntegrationId;
	};
};

export class EventsService extends Effect.Service<EventsService>()("EventsService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* EventsRepository;
		const entitiesRepository = yield* EntitiesRepository;
		const eventSchemasRepository = yield* EventSchemasRepository;

		const provideValidationContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				Effect.provideService(DbRunner, runWithDb),
				Effect.provideService(EntitiesRepository, entitiesRepository),
				Effect.provideService(EventSchemasRepository, eventSchemasRepository),
			);

		const provideWorkflowEngine = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(Effect.provideService(WorkflowEngine, engine));

		const requireReadableEntity = (userId: UserId, entityId: EntityId, notFoundMessage: string) =>
			Effect.gen(function* () {
				const scope = yield* runWithDb(
					entitiesRepository.getEntityScopeForUser({ userId, entityId }),
				);
				if (!scope) {
					return yield* notFound(notFoundMessage);
				}

				return scope;
			});

		const listForUser = Effect.fn("EventsService.listForUser")(function* (
			userId: UserId,
			query: { entityId?: EntityId; sessionEntityId?: EntityId; eventSchemaSlug?: string },
		) {
			if (!query.entityId && !query.sessionEntityId) {
				return yield* badRequest(listScopeRequiredError);
			}

			if (query.entityId) {
				yield* requireReadableEntity(userId, query.entityId, entityNotFoundError);
			}

			if (query.sessionEntityId) {
				yield* requireReadableEntity(userId, query.sessionEntityId, sessionEntityNotFoundError);
			}

			return yield* runWithDb(repository.listForUser({ userId, ...query }));
		});

		const list = Effect.fn("EventsService.list")(function* (
			user: CurrentUserValue,
			query: { entityId?: EntityId; sessionEntityId?: EntityId; eventSchemaSlug?: string },
		) {
			return yield* listForUser(user.id, query);
		});

		const create = Effect.fn("EventsService.create")(function* (input: EventCreateInput) {
			if (input.payload.length === 0) {
				return { count: 0 };
			}

			if (input.source === "integration" && !input.metadata?.integrationId) {
				return yield* badRequest("integrationId is required for integration event creation");
			}

			yield* provideValidationContext(
				validateEventCreateSubmission({ userId: input.userId, payload: input.payload }),
			);
			yield* provideWorkflowEngine(
				enqueueEventCreate({
					userId: input.userId,
					origin: input.source,
					payload: input.payload,
					executionId: input.executionId,
					importRunId: input.metadata?.importRunId,
					integrationId: input.metadata?.integrationId,
				}),
			);

			return { count: input.payload.length };
		});

		return { list, create, listForUser };
	}),
}) {}
