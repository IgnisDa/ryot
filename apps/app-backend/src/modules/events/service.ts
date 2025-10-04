import { DateTime, Effect, Option } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { DbRunner } from "../../lib/db";
import type { DbError, NotFound } from "../../lib/errors";
import { BadRequest, badRequest, notFound } from "../../lib/errors";
import { parseAppSchemaProperties } from "../../lib/property-schema-runtime";
import { requireText } from "../../lib/validation";
import { EntitiesRepository } from "../entities/repository";
import { EventSchemasRepository } from "../event-schemas/repository";
import { EventsRepository } from "./repository";
import type { CreateEventItem, CreateEventsResponse, ListedEvent } from "./schemas";

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const sessionEntityNotFoundError = "Session entity not found";
const invalidOccurredAtError = "occurredAt must be a valid date";
const listScopeRequiredError = "Either entityId or sessionEntityId is required";
const eventSchemaMismatchError = "Event schema does not belong to the entity schema";

const resolveOccurredAt = (occurredAt?: string): Effect.Effect<Date, BadRequest> => {
	if (!occurredAt) {
		return DateTime.nowAsDate;
	}

	const parsed = DateTime.make(occurredAt);
	if (Option.isNone(parsed)) {
		return badRequest(invalidOccurredAtError);
	}

	return Effect.succeed(DateTime.toDate(parsed.value));
};

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
		const repository = yield* EventsRepository;
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
				Effect.gen(function* () {
					const createdEvents = yield* Effect.forEach(payload, (item) =>
						Effect.gen(function* () {
							const entityId = requireText(item.entityId, "Entity id is required");
							if (entityId instanceof BadRequest) {
								return yield* entityId;
							}

							const eventSchemaId = requireText(item.eventSchemaId, "Event schema id is required");
							if (eventSchemaId instanceof BadRequest) {
								return yield* eventSchemaId;
							}

							const entityScope = yield* requireReadableEntity(
								user.id,
								entityId,
								entityNotFoundError,
							);

							const eventSchemaScope = yield* runWithDb(
								eventSchemasRepository.getScopeForUser({ userId: user.id, eventSchemaId }),
							);
							if (!eventSchemaScope) {
								return yield* notFound(eventSchemaNotFoundError);
							}

							if (eventSchemaScope.entitySchemaId !== entityScope.entitySchemaId) {
								return yield* badRequest(eventSchemaMismatchError);
							}

							let sessionEntityId: string | undefined;
							if (item.sessionEntityId) {
								const sessionScope = yield* requireReadableEntity(
									user.id,
									item.sessionEntityId,
									sessionEntityNotFoundError,
								);
								sessionEntityId = sessionScope.entityId;
							}

							const properties = yield* parseAppSchemaProperties({
								kind: "Event",
								properties: item.properties,
								propertiesSchema: eventSchemaScope.propertiesSchema,
							}).pipe(Effect.mapError((error) => badRequest(error.message)));

							const occurredAt = yield* resolveOccurredAt(item.occurredAt);

							return yield* runWithDb(
								repository.createEvent({
									properties,
									occurredAt,
									sessionEntityId,
									userId: user.id,
									entityId: entityScope.entityId,
									eventSchemaId: eventSchemaScope.id,
									eventSchemaName: eventSchemaScope.name,
									eventSchemaSlug: eventSchemaScope.slug,
								}),
							);
						}),
					);

					return { count: createdEvents.length };
				}),
		} satisfies EventsServiceShape;
	}),
}) {}
