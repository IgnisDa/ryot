import type { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityDraft,
	type AutomationEventDraft,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type CreateEventItem,
	EventCreateItemError,
} from "@ryot-app/contract/modules/events/schemas";
import {
	type DefinitionOwner,
	definitionOwner,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Option, type Result, Schema } from "effect";

import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	type DomainLifecycleCommand,
	domainWriteCheckKey,
	DomainWriteChecks,
	type DomainWriteConflict,
	type DomainWritePin,
} from "#modules/entities/write-context";

export const CapturedEventReferences = Schema.Record(EntityId, Schema.String);

export type CapturedEventReferences = typeof CapturedEventReferences.Type;

const eventReferences = (
	draft: Pick<AutomationEventDraft, "entityId" | "sessionEntityId">,
): ReadonlyArray<readonly [EntityId, "entity-not-found" | "session-entity-not-found"]> => [
	[draft.entityId, "entity-not-found"],
	...(draft.sessionEntityId === null
		? []
		: [[draft.sessionEntityId, "session-entity-not-found"] as const]),
];

const capturedEventReference = (entity: {
	readonly properties: unknown;
	readonly entitySchemaSlug: string;
	readonly entitySchemaPluginId: string | null;
}) =>
	stableStringify({
		properties: entity.properties,
		entitySchemaSlug: entity.entitySchemaSlug,
		entitySchemaPluginId: entity.entitySchemaPluginId,
	});

export const capturedEventReferences = Effect.fn("capturedEventReferences")(function* (
	userId: UserId,
	draft: Pick<AutomationEventDraft, "entityId" | "sessionEntityId">,
	previous: CapturedEventReferences = {},
) {
	const entitiesRepository = yield* EntitiesRepository;
	const captured: CapturedEventReferences = { ...previous };
	for (const [entityId, code] of new Map(eventReferences(draft))) {
		if (Object.hasOwn(captured, entityId)) {
			continue;
		}
		const entity = yield* entitiesRepository.getByIdForUser({ userId, entityId });
		if (!entity) {
			return yield* new EventCreateItemError({ reason: { code, entityId } });
		}
		Object.assign(captured, { [entityId]: capturedEventReference(entity) });
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
		for (const [entityId, code] of eventReferences(draft)) {
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

type EventCreateEntityScope = {
	readonly entityId: EntityId;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entitySchemaPluginId: string | null;
};

type EventCreateSchemaInput = {
	readonly eventSchemaSlug: EventSchemaSlug;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly entitySchemaPluginId: string | null;
};

type EventCreateScopeReads = {
	readonly entityScope: (
		entityId: EntityId,
	) => Effect.Effect<EventCreateEntityScope | null, DbError>;
	readonly check: (
		owner: DefinitionOwner,
	) => Effect.Effect<DomainWritePin | null, DbError | DomainWriteConflict>;
	readonly eventSchemaScope: (
		input: EventCreateSchemaInput,
	) => Effect.Effect<
		Effect.Success<ReturnType<EventSchemaReader["Service"]["getScopeForUser"]>>,
		DbError
	>;
	readonly pinnedDeclaration: (
		pinId: string,
		slugs: { readonly eventSchemaSlug: string; readonly entitySchemaSlug: string },
	) => Effect.Effect<{ readonly propertiesSchema: AppSchema } | undefined, DbError>;
};

const requireReadableEntity = Effect.fnUntraced(function* (
	reads: EventCreateScopeReads,
	entityId: EntityId,
	reason: {
		readonly entityId: EntityId;
		readonly code: "entity-not-found" | "session-entity-not-found";
	},
) {
	const scope = yield* reads.entityScope(entityId);
	if (!scope) {
		return yield* new EventCreateItemError({ reason });
	}

	return scope;
});

const resolveScopes = Effect.fnUntraced(function* (
	item: CreateEventItem,
	reads: EventCreateScopeReads,
) {
	const rawEntityId = item.entityId.trim();
	if (!rawEntityId) {
		return yield* new EventCreateItemError({ reason: { code: "entity-id-required" } });
	}
	const rawEventSchemaSlug = item.eventSchemaSlug.trim();
	if (!rawEventSchemaSlug) {
		return yield* new EventCreateItemError({ reason: { code: "event-schema-slug-required" } });
	}
	const entityId = EntityId.make(rawEntityId);
	const eventSchemaSlug = EventSchemaSlug.make(rawEventSchemaSlug);

	const entityScope = yield* requireReadableEntity(reads, entityId, {
		entityId,
		code: "entity-not-found",
	});
	const pin = yield* reads
		.check(definitionOwner(entityScope.entitySchemaPluginId))
		.pipe(
			Effect.mapError(
				() => new EventCreateItemError({ reason: { entityId, code: "entity-not-found" } }),
			),
		);
	const eventSchemaScope = yield* reads.eventSchemaScope({
		eventSchemaSlug,
		entitySchemaPluginId: entityScope.entitySchemaPluginId,
		entitySchemaSlug: EntitySchemaSlug.make(entityScope.entitySchemaSlug),
	});
	if (!eventSchemaScope) {
		return yield* new EventCreateItemError({
			reason: { eventSchemaSlug, code: "event-schema-not-found" },
		});
	}
	const declaration = pin
		? yield* reads.pinnedDeclaration(pin.id, {
				eventSchemaSlug,
				entitySchemaSlug: entityScope.entitySchemaSlug,
			})
		: undefined;
	if (pin && !declaration) {
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
	const rawSessionEntityId = item.sessionEntityId?.trim();
	if (rawSessionEntityId) {
		const requestedSessionEntityId = EntityId.make(rawSessionEntityId);
		const sessionScope = yield* requireReadableEntity(reads, requestedSessionEntityId, {
			code: "session-entity-not-found",
			entityId: requestedSessionEntityId,
		});
		if (pin && sessionScope.entitySchemaPluginId !== entityScope.entitySchemaPluginId) {
			return yield* new EventCreateItemError({
				reason: { code: "session-entity-not-found", entityId: requestedSessionEntityId },
			});
		}
		sessionEntityId = sessionScope.entityId;
	}

	const occurredAt = yield* resolveOccurredAt(item.occurredAt);

	return {
		entityId,
		occurredAt,
		entityScope,
		eventSchemaSlug,
		sessionEntityId,
		activePropertiesSchema: eventSchemaScope.propertiesSchema,
		eventSchemaScope: declaration
			? { ...eventSchemaScope, propertiesSchema: declaration.propertiesSchema }
			: eventSchemaScope,
	};
});

export const resolveEventCreateItemScopes = Effect.fn("resolveEventCreateItemScopes")(
	function* (input: {
		readonly item: CreateEventItem;
		readonly userId: UserId;
		readonly command: DomainLifecycleCommand;
		readonly commit?: boolean;
	}) {
		const eventSchemasRepository = yield* EventSchemaReader;
		const entitiesRepository = yield* EntitiesRepository;
		const checks = yield* DomainWriteChecks;
		return yield* resolveScopes(input.item, {
			pinnedDeclaration: (pinId, slugs) => checks.findPinnedDeclaration("event", pinId, slugs),
			check: (owner) => checks.check(input.command, owner, input.userId, input.commit ?? false),
			entityScope: (entityId) =>
				entitiesRepository.getEntityScopeForUser({ entityId, userId: input.userId }),
			eventSchemaScope: (scope) =>
				eventSchemasRepository.getScopeForUser({ ...scope, userId: input.userId }),
		});
	},
);

const schemaInputKey = (input: EventCreateSchemaInput) =>
	stableStringify([input.eventSchemaSlug, input.entitySchemaPluginId, input.entitySchemaSlug]);

export const readEventCreateChunkScopes = Effect.fn("readEventCreateChunkScopes")(
	function* (input: {
		readonly userId: UserId;
		readonly items: ReadonlyArray<CreateEventItem>;
		readonly commands: ReadonlyArray<DomainLifecycleCommand>;
		readonly writeCommand: DomainLifecycleCommand;
		readonly proposedEntities?: Readonly<Record<string, AutomationEntityDraft>>;
	}) {
		const eventSchemasRepository = yield* EventSchemaReader;
		const entitiesRepository = yield* EntitiesRepository;
		const checks = yield* DomainWriteChecks;
		const entityIds = input.items.flatMap((item) =>
			[item.entityId.trim(), item.sessionEntityId?.trim() ?? ""].flatMap((id) =>
				id ? [EntityId.make(id)] : [],
			),
		);
		yield* entitiesRepository.lockEntityReferencesByIds(entityIds);
		const entities = yield* entitiesRepository.getByIdsForUser({ entityIds, userId: input.userId });
		const referenceOf = (id: EntityId) => input.proposedEntities?.[id] ?? entities.get(id);
		const schemaInputs = new Map<string, EventCreateSchemaInput>();
		for (const item of input.items) {
			const entity = referenceOf(EntityId.make(item.entityId.trim()));
			const eventSchemaSlug = item.eventSchemaSlug.trim();
			if (entity && eventSchemaSlug) {
				const schemaInput = {
					entitySchemaSlug: entity.entitySchemaSlug,
					entitySchemaPluginId: entity.entitySchemaPluginId,
					eventSchemaSlug: EventSchemaSlug.make(eventSchemaSlug),
				};
				schemaInputs.set(schemaInputKey(schemaInput), schemaInput);
			}
		}
		const schemaScopes = yield* eventSchemasRepository.getScopesForUser(input.userId, [
			...schemaInputs.values(),
		]);
		const eventSchemaScopes = new Map(
			[...schemaInputs.keys()].map((key, index) => [key, schemaScopes[index] ?? null]),
		);
		const checked = new Map<
			string,
			Result.Result<DomainWritePin | null, DbError | DomainWriteConflict>
		>();
		const check = Effect.fnUntraced(function* (
			command: DomainLifecycleCommand,
			owner: DefinitionOwner,
		) {
			const key = domainWriteCheckKey({ owner, command, scopeUserId: input.userId });
			let result = checked.get(key);
			if (!result) {
				result = yield* Effect.result(checks.check(command, owner, input.userId, true));
				checked.set(key, result);
			}
			return yield* Effect.fromResult(result);
		});
		const precheck = (command: DomainLifecycleCommand, owner: DefinitionOwner) =>
			check(command, owner).pipe(
				Effect.catchIf(
					(error) => error._tag !== "DbError" || error.code === undefined,
					() => Effect.void,
				),
			);
		for (const item of input.items) {
			const entity = referenceOf(EntityId.make(item.entityId.trim()));
			if (entity) {
				for (const command of input.commands) {
					yield* precheck(command, definitionOwner(entity.entitySchemaPluginId));
				}
			}
		}
		for (const scope of eventSchemaScopes.values()) {
			if (scope) {
				yield* precheck(input.writeCommand, definitionOwner(scope.pluginId));
			}
		}
		const declarations = new Map<string, { readonly propertiesSchema: AppSchema } | undefined>();
		const reads = (command: DomainLifecycleCommand): EventCreateScopeReads => ({
			check: (owner) => check(command, owner),
			eventSchemaScope: (scope) =>
				Effect.succeed(eventSchemaScopes.get(schemaInputKey(scope)) ?? null),
			pinnedDeclaration: Effect.fnUntraced(function* (pinId, slugs) {
				const key = stableStringify([pinId, slugs]);
				if (!declarations.has(key)) {
					declarations.set(key, yield* checks.findPinnedDeclaration("event", pinId, slugs));
				}
				return declarations.get(key);
			}),
			entityScope: (entityId) => {
				const entity = referenceOf(entityId);
				return Effect.succeed(
					entity
						? {
								entityId,
								entitySchemaSlug: entity.entitySchemaSlug,
								entitySchemaPluginId: entity.entitySchemaPluginId,
							}
						: null,
				);
			},
		});
		return {
			check,
			resolve: (item: CreateEventItem, command: DomainLifecycleCommand) =>
				resolveScopes(item, reads(command)),
			capture: Effect.fnUntraced(function* (
				draft: Pick<AutomationEventDraft, "entityId" | "sessionEntityId">,
			) {
				const captured: CapturedEventReferences = {};
				for (const [entityId, code] of new Map(eventReferences(draft))) {
					const entity = referenceOf(entityId);
					if (!entity) {
						return yield* new EventCreateItemError({ reason: { code, entityId } });
					}
					Object.assign(captured, { [entityId]: capturedEventReference(entity) });
				}
				return captured;
			}),
			references: yield* Schema.decodeUnknownEffect(Schema.Record(EntityId, AutomationEntityDraft))(
				Object.fromEntries(
					[...new Set(entityIds)].flatMap((id) => {
						const entity = referenceOf(id);
						return entity
							? [
									[
										id,
										{
											name: entity.name,
											properties: entity.properties,
											providerId: entity.providerId,
											externalId: entity.externalId,
											populatedAt: entity.populatedAt,
											entitySchemaSlug: entity.entitySchemaSlug,
											entitySchemaPluginId: entity.entitySchemaPluginId,
										},
									],
								]
							: [];
					}),
				),
			).pipe(
				Effect.mapError(() => new EventCreateItemError({ reason: { code: "invalid-properties" } })),
			),
		};
	},
);
