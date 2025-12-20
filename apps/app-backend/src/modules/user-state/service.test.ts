import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaId,
	EventId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { UserStateService } from "./service";

const user = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		...overrides,
		_tag: "EntitiesRepository",
	});

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({
		...overrides,
		_tag: "EventsRepository",
	});

const mockEventsService = Layer.mock(EventsService);

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		...overrides,
		_tag: "EventsService",
	});

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		...overrides,
		_tag: "RelationshipsRepository",
	});

const mockRelationshipsService = Layer.mock(RelationshipsService);

const makeRelationshipsService = (overrides: MockOverrides<typeof mockRelationshipsService> = {}) =>
	mockRelationshipsService({
		...overrides,
		_tag: "RelationshipsService",
	});

const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		...overrides,
		_tag: "RelationshipSchemasRepository",
	});

const makeServiceLayer = (
	options: {
		eventsRepository?: ReturnType<typeof makeEventsRepository>;
		eventsService?: ReturnType<typeof makeEventsService>;
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		relationshipsService?: ReturnType<typeof makeRelationshipsService>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
		relationshipSchemasRepository?: ReturnType<typeof makeRelationshipSchemasRepository>;
	} = {},
) =>
	UserStateService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				options.entitiesRepository ?? makeEntitiesRepository(),
				options.eventsRepository ?? makeEventsRepository(),
				options.eventsService ?? makeEventsService(),
				options.relationshipsRepository ?? makeRelationshipsRepository(),
				options.relationshipsService ?? makeRelationshipsService(),
				options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
			),
		),
	);

const makeMergeScope = (overrides: {
	entityId: EntityId;
	entitySchemaId?: EntitySchemaId;
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
}) => ({
	isBuiltin: false,
	entityUserId: user.id,
	entityId: overrides.entityId,
	properties: overrides.properties ?? {},
	entitySchemaSlug: overrides.entitySchemaSlug ?? "book",
	entitySchemaId: overrides.entitySchemaId ?? EntitySchemaId.make("schema-id"),
});

it.effect("rejects clearing library user state", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityName: "Library",
					entityUserId: user.id,
					entityId: EntityId.make("library-entity"),
					entitySchemaSlug: "library",
					entitySchemaId: EntitySchemaId.make("library-schema"),
					propertiesSchema: { fields: {} },
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(service.clearUserState(user, EntityId.make("library-entity")));

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Library entity user state cannot be cleared" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("deletes matching events through EventsService when clearing user state", () => {
	const deletedEventIds: EventId[] = [];
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: false,
					entityName: "Dune",
					entityUserId: user.id,
					entitySchemaSlug: "book",
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("entity-1"),
					entitySchemaId: EntitySchemaId.make("book-schema"),
				}),
		}),
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () =>
				Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
		}),
		eventsService: makeEventsService({
			delete: (input) =>
				Effect.sync(() => {
					deletedEventIds.push(input.eventId);
					return input.eventId;
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntity: () => Effect.succeed([]),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const result = yield* service.clearUserState(user, EntityId.make("entity-1"));

		expect(result).toEqual({
			deletedEventsCount: 2,
			deletedRelationshipsCount: 0,
			entityId: EntityId.make("entity-1"),
		});
		expect(deletedEventIds).toEqual([EventId.make("event-1"), EventId.make("event-2")]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging an entity into itself", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("entity-id"),
				mergeInto: EntityId.make("entity-id"),
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot merge an entity into itself" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when one merge entity is not visible", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(entityId === "from" ? makeMergeScope({ entityId }) : null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("from"),
				mergeInto: EntityId.make("into"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging entities from different schemas", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaId:
							entityId === "from"
								? EntitySchemaId.make("schema-a")
								: EntitySchemaId.make("schema-b"),
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("from"),
				mergeInto: EntityId.make("into"),
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Entities must belong to the same schema" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging exercises with different kinds", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: "exercise",
						properties: { kind: entityId === "from" ? "reps" : "duration" },
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("from"),
				mergeInto: EntityId.make("into"),
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Exercises must have the same kind" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("moves events and relationships for valid merges", () => {
	const calls: string[] = [];
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) => Effect.succeed(makeMergeScope({ entityId })),
		}),
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () =>
				Effect.succeed([EventId.make("event-1"), EventId.make("event-2")]),
		}),
		eventsService: makeEventsService({
			update: (input) =>
				Effect.sync(() => {
					calls.push(`${input.eventId}:${input.mergeFrom}->${input.mergeInto}:events`);
					return input.eventId;
				}),
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findById: () =>
				Effect.succeed({
					isBuiltin: true,
					slug: "relationship",
					name: "Relationship",
					sourceEntitySchemaId: null,
					targetEntitySchemaId: null,
					propertiesSchema: { fields: {} },
					id: RelationshipSchemaId.make("relationship-schema"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntity: () =>
				Effect.succeed([
					{
						properties: {},
						createdAt: "2026-01-01T00:00:00.000Z",
						sourceEntityId: EntityId.make("from"),
						id: RelationshipId.make("relationship-1"),
						targetEntityId: EntityId.make("target-1"),
						relationshipSchemaId: RelationshipSchemaId.make("relationship-schema"),
					},
					{
						properties: {},
						createdAt: "2026-01-01T00:00:00.000Z",
						targetEntityId: EntityId.make("from"),
						id: RelationshipId.make("relationship-2"),
						sourceEntityId: EntityId.make("target-2"),
						relationshipSchemaId: RelationshipSchemaId.make("relationship-schema"),
					},
					{
						properties: {},
						createdAt: "2026-01-01T00:00:00.000Z",
						sourceEntityId: EntityId.make("from"),
						targetEntityId: EntityId.make("from"),
						id: RelationshipId.make("relationship-3"),
						relationshipSchemaId: RelationshipSchemaId.make("relationship-schema"),
					},
				]),
		}),
		relationshipsService: makeRelationshipsService({
			create: (input) =>
				Effect.sync(() => {
					calls.push(`${input.sourceEntityId}->${input.targetEntityId}:create`);
					return {
						properties: {},
						wasInserted: true,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						id: RelationshipId.make("created"),
						createdAt: "2026-01-01T00:00:00.000Z",
						relationshipSchemaId: input.relationshipSchemaId,
					};
				}),
			delete: (input) =>
				Effect.sync(() => {
					calls.push(`${input.sourceEntityId}->${input.targetEntityId}:delete`);
					return {
						properties: {},
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						id: RelationshipId.make("deleted"),
						createdAt: "2026-01-01T00:00:00.000Z",
						relationshipSchemaId: input.relationshipSchemaId,
					};
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const result = yield* service.mergeUserState(user, {
			mergeFrom: EntityId.make("from"),
			mergeInto: EntityId.make("into"),
		});

		expect(result).toEqual({
			mergeFrom: "from",
			mergeInto: "into",
			movedEventsCount: 2,
			movedRelationshipsCount: 3,
		});
		expect(calls).toEqual([
			"event-1:from->into:events",
			"event-2:from->into:events",
			"into->target-1:create",
			"from->target-1:delete",
			"target-2->into:create",
			"target-2->from:delete",
			"from->from:delete",
		]);
	}).pipe(Effect.provide(layer));
});
