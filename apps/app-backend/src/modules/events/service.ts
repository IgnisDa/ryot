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
import type { CreateEventItem } from "./schemas";
import { enqueueEventCreate, runEventCreate } from "./workflows";

const entityNotFoundError = "Entity not found";
const sessionEntityNotFoundError = "Session entity not found";
const listScopeRequiredError = "Either entityId or sessionEntityId is required";

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

		const list = Effect.fn("EventsService.list")(function* (
			user: CurrentUserValue,
			query: { entityId?: EntityId; sessionEntityId?: EntityId; eventSchemaSlug?: string },
		) {
			if (!query.entityId && !query.sessionEntityId) {
				return yield* badRequest(listScopeRequiredError);
			}

			if (query.entityId) {
				yield* requireReadableEntity(user.id, query.entityId, entityNotFoundError);
			}

			if (query.sessionEntityId) {
				yield* requireReadableEntity(user.id, query.sessionEntityId, sessionEntityNotFoundError);
			}

			return yield* runWithDb(repository.listForUser({ userId: user.id, ...query }));
		});

		const create = Effect.fn("EventsService.create")(function* (
			user: CurrentUserValue,
			payload: ReadonlyArray<CreateEventItem>,
		) {
			if (payload.length === 0) {
				return { count: 0 };
			}

			yield* provideValidationContext(validateEventCreateSubmission({ userId: user.id, payload }));
			yield* provideWorkflowEngine(enqueueEventCreate({ userId: user.id, origin: "api", payload }));

			return { count: payload.length };
		});

		const createForImport = (
			userId: UserId,
			payload: ReadonlyArray<CreateEventItem>,
			importRunId?: ImportRunId,
			executionId?: string,
		) =>
			payload.length === 0
				? Effect.succeed({ count: 0 })
				: provideWorkflowEngine(
						runEventCreate({ userId, payload, importRunId, executionId, origin: "import" }),
					);

		const createForIntegration = (input: {
			userId: UserId;
			executionId?: string;
			importRunId: ImportRunId;
			integrationId: IntegrationId;
			payload: ReadonlyArray<CreateEventItem>;
		}) =>
			input.payload.length === 0
				? Effect.succeed({ count: 0 })
				: provideWorkflowEngine(
						runEventCreate({
							userId: input.userId,
							origin: "integration",
							payload: input.payload,
							importRunId: input.importRunId,
							executionId: input.executionId,
							integrationId: input.integrationId,
						}),
					);

		return { list, create, createForImport, createForIntegration };
	}),
}) {}
