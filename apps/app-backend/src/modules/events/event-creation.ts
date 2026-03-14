import type { BadRequest } from "@ryot/contract/errors";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { CreateEventItem } from "@ryot/contract/modules/events/schemas";
import { EntityId, EventSchemaId } from "@ryot/contract/schema/brands";
import type { UserId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Option } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { requireText } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

const entityNotFoundError = "Entity not found";
const eventSchemaNotFoundError = "Event schema not found";
const sessionEntityNotFoundError = "Session entity not found";
const invalidOccurredAtError = "occurredAt must be a valid date";
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

const requireReadableEntity = Effect.fn(function* (
	userId: UserId,
	entityId: EntityId,
	notFoundMessage: string,
) {
	const runWithDb = yield* DbRunner;
	const entitiesRepository = yield* EntitiesRepository;
	const scope = yield* runWithDb(entitiesRepository.getEntityScopeForUser({ userId, entityId }));
	if (!scope) {
		return yield* notFound(notFoundMessage);
	}

	return scope;
});

export const resolveEventCreateItemScopes = Effect.fn("resolveEventCreateItemScopes")(
	function* (input: { readonly item: CreateEventItem; readonly userId: UserId }) {
		const runWithDb = yield* DbRunner;
		const eventSchemasRepository = yield* EventSchemasRepository;
		const entityId = EntityId.make(
			yield* requireText(input.item.entityId, "Entity id is required"),
		);
		const eventSchemaId = EventSchemaId.make(
			yield* requireText(input.item.eventSchemaId, "Event schema id is required"),
		);

		const entityScope = yield* requireReadableEntity(input.userId, entityId, entityNotFoundError);
		const eventSchemaScope = yield* runWithDb(
			eventSchemasRepository.getScopeForUser({ userId: input.userId, eventSchemaId }),
		);
		if (!eventSchemaScope) {
			return yield* notFound(eventSchemaNotFoundError);
		}

		if (eventSchemaScope.entitySchemaId !== entityScope.entitySchemaId) {
			return yield* badRequest(eventSchemaMismatchError);
		}

		let sessionEntityId: EntityId | undefined;
		if (input.item.sessionEntityId) {
			const sessionScope = yield* requireReadableEntity(
				input.userId,
				input.item.sessionEntityId,
				sessionEntityNotFoundError,
			);
			sessionEntityId = sessionScope.entityId;
		}

		const occurredAt = yield* resolveOccurredAt(input.item.occurredAt);

		return { entityId, eventSchemaId, entityScope, eventSchemaScope, sessionEntityId, occurredAt };
	},
);
