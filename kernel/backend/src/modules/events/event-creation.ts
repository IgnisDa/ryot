import type { AutomationEventDraft } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventCreateItemError,
	type CreateEventItem,
} from "@ryot-app/contract/modules/events/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Option, Schema } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

export const CapturedEventReferences = Schema.Record(EntityId, Schema.String);

export type CapturedEventReferences = typeof CapturedEventReferences.Type;

export const capturedEventReferences = Effect.fn("capturedEventReferences")(function* (
	userId: UserId,
	draft: Pick<AutomationEventDraft, "entityId" | "sessionEntityId">,
	previous: CapturedEventReferences = {},
) {
	const entitiesRepository = yield* EntitiesRepository;
	const referenceReasons = new Map<EntityId, "entity-not-found" | "session-entity-not-found">([
		[draft.entityId, "entity-not-found"],
	]);
	if (draft.sessionEntityId !== null) {
		referenceReasons.set(draft.sessionEntityId, "session-entity-not-found");
	}
	const captured: CapturedEventReferences = { ...previous };
	for (const [entityId, code] of referenceReasons) {
		if (Object.hasOwn(captured, entityId)) {
			continue;
		}
		const entity = yield* entitiesRepository.getByIdForUser({ userId, entityId });
		if (!entity) {
			return yield* new EventCreateItemError({ reason: { code, entityId } });
		}
		Object.assign(captured, {
			[entityId]: stableStringify({
				properties: entity.properties,
				entitySchemaSlug: entity.entitySchemaSlug,
			}),
		});
	}
	return captured;
});

export const validateCapturedEventReferences = Effect.fn("validateCapturedEventReferences")(
	function* (
		userId: UserId,
		draft: Pick<AutomationEventDraft, "entityId" | "sessionEntityId">,
		captured: CapturedEventReferences,
	) {
		const current = yield* capturedEventReferences(userId, draft);
		const references: Array<{
			entityId: EntityId;
			code: "entity-not-found" | "session-entity-not-found";
		}> = [{ entityId: draft.entityId, code: "entity-not-found" }];
		if (draft.sessionEntityId !== null) {
			references.push({ entityId: draft.sessionEntityId, code: "session-entity-not-found" });
		}
		for (const { code, entityId } of references) {
			if (captured[entityId] !== current[entityId]) {
				return yield* new EventCreateItemError({ reason: { code, entityId } });
			}
		}
		return undefined;
	},
);

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
