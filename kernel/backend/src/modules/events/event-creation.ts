import {
	EventCreateItemError,
	type CreateEventItem,
} from "@ryot-app/contract/modules/events/schemas";
import { EntityId, EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Option } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

const resolveOccurredAt = (occurredAt?: string) => {
	if (!occurredAt) {
		return DateTime.nowAsDate;
	}

	const parsed = DateTime.make(occurredAt);
	if (Option.isNone(parsed)) {
		return new EventCreateItemError({ reason: { occurredAt, code: "invalid-occurred-at" } });
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
			entitySchemaPluginId: entityScope.entitySchemaPluginId,
			entitySchemaSlug: EntitySchemaSlug.make(entityScope.entitySchemaSlug),
		});
		if (!eventSchemaScope) {
			return yield* new EventCreateItemError({
				reason: { eventSchemaSlug, code: "event-schema-not-found" },
			});
		}

		if (eventSchemaScope.entitySchemaSlug !== entityScope.entitySchemaSlug) {
			return yield* new EventCreateItemError({
				reason: { entityId, eventSchemaSlug, code: "event-schema-mismatch" },
			});
		}

		let sessionEntityId: EntityId | undefined;
		const rawSessionEntityId = input.item.sessionEntityId?.trim();
		if (rawSessionEntityId) {
			const requestedSessionEntityId = EntityId.make(rawSessionEntityId);
			const sessionScope = yield* requireReadableEntity(input.userId, requestedSessionEntityId, {
				code: "session-entity-not-found",
				entityId: requestedSessionEntityId,
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
