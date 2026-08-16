import { EventCreateItemError, type CreateEventItem } from "@ryot/contract/modules/events/schemas";
import { EntityId, EntitySchemaSlug, EventSchemaSlug } from "@ryot/contract/schema/brands";
import type { UserId } from "@ryot/contract/schema/brands";
import { DateTime, Effect, Option } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

const resolveOccurredAt = (occurredAt?: string) => {
	if (!occurredAt) {
		return DateTime.nowAsDate;
	}

	const parsed = DateTime.make(occurredAt);
	if (Option.isNone(parsed)) {
		return new EventCreateItemError({ reason: { code: "invalid-occurred-at", occurredAt } });
	}

	return Effect.succeed(DateTime.toDate(parsed.value));
};

const requireReadableEntity = Effect.fn(function* (
	userId: UserId,
	entityId: EntityId,
	reason: {
		readonly entityId: EntityId;
		readonly code: "entity-not-found" | "session-entity-not-found";
	},
) {
	const entitiesRepository = yield* EntitiesRepository;
	const scope = yield* entitiesRepository.getEntityScopeForUser({ userId, entityId });
	if (!scope) {
		return yield* new EventCreateItemError({ reason });
	}

	return scope;
});

export const resolveEventCreateItemScopes = Effect.fn("resolveEventCreateItemScopes")(
	function* (input: { readonly item: CreateEventItem; readonly userId: UserId }) {
		const eventSchemasRepository = yield* EventSchemasRepository;
		const rawEntityId = input.item.entityId.trim();
		if (!rawEntityId) {
			return yield* new EventCreateItemError({ reason: { code: "entity-id-required" } });
		}
		const rawEventSchemaSlug = input.item.eventSchemaSlug.trim();
		if (!rawEventSchemaSlug) {
			return yield* new EventCreateItemError({ reason: { code: "event-schema-slug-required" } });
		}
		const entityId = EntityId.make(rawEntityId);
		const eventSchemaSlug = EventSchemaSlug.make(rawEventSchemaSlug);

		const entityScope = yield* requireReadableEntity(input.userId, entityId, {
			entityId,
			code: "entity-not-found",
		});
		const eventSchemaScope = yield* eventSchemasRepository.getScopeForUser({
			eventSchemaSlug,
			userId: input.userId,
			entitySchemaSlug: EntitySchemaSlug.make(entityScope.entitySchemaSlug),
		});
		if (!eventSchemaScope) {
			return yield* new EventCreateItemError({
				reason: { code: "event-schema-not-found", eventSchemaSlug },
			});
		}

		if (eventSchemaScope.entitySchemaSlug !== entityScope.entitySchemaSlug) {
			return yield* new EventCreateItemError({
				reason: { code: "event-schema-mismatch", entityId, eventSchemaSlug },
			});
		}

		let sessionEntityId: EntityId | undefined;
		if (input.item.sessionEntityId) {
			const sessionScope = yield* requireReadableEntity(input.userId, input.item.sessionEntityId, {
				code: "session-entity-not-found",
				entityId: input.item.sessionEntityId,
			});
			sessionEntityId = sessionScope.entityId;
		}

		const occurredAt = yield* resolveOccurredAt(input.item.occurredAt);

		return {
			entityId,
			occurredAt,
			entityScope,
			eventSchemaSlug,
			sessionEntityId,
			eventSchemaScope,
		};
	},
);
