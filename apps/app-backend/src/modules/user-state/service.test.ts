import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { UserStateBadRequest, UserStateNotFound } from "@ryot/contract/modules/user-state/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { databaseLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { UserStateService } from "./service";

const user = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { allowNsfw: false, language: null, disableIntegrations: false },
} satisfies CurrentUserValue;

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		...overrides,
	});

const mockEventsRepository = Layer.mock(EventsRepository);

const makeEventsRepository = (overrides: MockOverrides<typeof mockEventsRepository> = {}) =>
	mockEventsRepository({
		...overrides,
	});

const mockEventsService = Layer.mock(EventsService);

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		...overrides,
	});

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		...overrides,
	});

const mockRelationshipsService = Layer.mock(RelationshipsService);

const makeRelationshipsService = (overrides: MockOverrides<typeof mockRelationshipsService> = {}) =>
	mockRelationshipsService({
		...overrides,
	});

const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		...overrides,
	});

const makeDefinitionRegistryLayer = (
	mergeIdentityProperties: ReadonlyArray<string> = [],
	deniedOperationsBySchema: Readonly<Record<string, ReadonlyArray<"clear" | "merge">>> = {},
) =>
	Layer.succeed(DefinitionRegistry, {
		...makeDefinitionRegistry({
			savedViews: [],
			signalSchemas: [],
			relationshipSchemas: [],
			entitySchemas: [
				{
					icon: "book",
					name: "Book",
					slug: "book",
					eventSchemas: [],
					pluginSlug: "test",
					mergeIdentityProperties,
					propertiesSchema: {
						fields: { kind: { type: "string", label: "Kind", description: "Book kind" } },
					},
					userState: deniedOperationsBySchema["book"]
						? { deniedOperations: deniedOperationsBySchema["book"] }
						: undefined,
				},
				...Object.entries(deniedOperationsBySchema)
					.filter(([slug]) => slug !== "book")
					.map(([slug, deniedOperations]) => ({
						slug,
						icon: "box",
						name: slug,
						eventSchemas: [],
						pluginSlug: "test",
						userState: { deniedOperations },
						propertiesSchema: { fields: {} },
					})),
			],
		}),
	});

const makeServiceLayer = (
	options: {
		eventsService?: ReturnType<typeof makeEventsService>;
		eventsRepository?: ReturnType<typeof makeEventsRepository>;
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		relationshipsService?: ReturnType<typeof makeRelationshipsService>;
		definitionRegistry?: ReturnType<typeof makeDefinitionRegistryLayer>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
		relationshipSchemasRepository?: ReturnType<typeof makeRelationshipSchemasRepository>;
	} = {},
) =>
	UserStateService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				options.definitionRegistry ?? makeDefinitionRegistryLayer(),
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
	entitySchemaSlug?: string;
	properties?: Record<string, unknown>;
}) => ({
	isBuiltin: false,
	entityUserId: user.id,
	entityId: overrides.entityId,
	properties: overrides.properties ?? {},
	entitySchemaSlug: EntitySchemaSlug.make(overrides.entitySchemaSlug ?? "book"),
});

it.effect("rejects clearing user state when the entity schema denies it", () => {
	const layer = makeServiceLayer({
		definitionRegistry: makeDefinitionRegistryLayer([], { library: ["clear", "merge"] }),
		entitiesRepository: makeEntitiesRepository({
			getEntityScopeForUser: () =>
				Effect.succeed({
					isBuiltin: true,
					entityName: "Library",
					entityUserId: user.id,
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("library-entity"),
					entitySchemaSlug: EntitySchemaSlug.make("library"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const exit = yield* Effect.exit(service.clearUserState(user, EntityId.make("library-entity")));

		assertExitFails(
			exit,
			new UserStateBadRequest({
				reason: { code: "operation-denied", operation: "clear" },
			}),
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
					entitySchemaSlug: EntitySchemaSlug.make("book"),
					propertiesSchema: { fields: {} },
					entityId: EntityId.make("entity-1"),
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

		assertExitFails(exit, new UserStateBadRequest({ reason: { code: "same-entity-merge" } }));
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

		assertExitFails(
			exit,
			new UserStateNotFound({
				reason: {
					code: "entity-not-found",
					entityIds: [EntityId.make("from"), EntityId.make("into")],
				},
			}),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging when either source or destination schema denies it", () => {
	const layer = makeServiceLayer({
		definitionRegistry: makeDefinitionRegistryLayer([], { blocked: ["merge"] }),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: entityId.includes("blocked") ? "blocked" : "book",
					}),
				),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* UserStateService;
		const sourceDenied = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("blocked-source"),
				mergeInto: EntityId.make("allowed-destination"),
			}),
		);
		const destinationDenied = yield* Effect.exit(
			service.mergeUserState(user, {
				mergeFrom: EntityId.make("allowed-source"),
				mergeInto: EntityId.make("blocked-destination"),
			}),
		);

		const expected = new UserStateBadRequest({
			reason: { code: "operation-denied", operation: "merge" },
		});
		assertExitFails(sourceDenied, expected);
		assertExitFails(destinationDenied, expected);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging entities from different schemas", () => {
	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						entitySchemaSlug: entityId === "from" ? "schema-a" : "schema-b",
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

		assertExitFails(exit, new UserStateBadRequest({ reason: { code: "entity-schema-mismatch" } }));
	}).pipe(Effect.provide(layer));
});

it.effect("allows merging entities with matching declared identity properties", () => {
	const layer = makeServiceLayer({
		definitionRegistry: makeDefinitionRegistryLayer(["kind"]),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(makeMergeScope({ entityId, properties: { kind: "novel" } })),
		}),
		eventsRepository: makeEventsRepository({
			listUserEventIdsForEntity: () => Effect.succeed([]),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listUserRelationshipsForEntity: () => Effect.succeed([]),
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
			movedEventsCount: 0,
			movedRelationshipsCount: 0,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects merging entities with mismatched declared identity properties", () => {
	const layer = makeServiceLayer({
		definitionRegistry: makeDefinitionRegistryLayer(["kind"]),
		entitiesRepository: makeEntitiesRepository({
			getEntityMergeScopeForUser: ({ entityId }) =>
				Effect.succeed(
					makeMergeScope({
						entityId,
						properties: { kind: entityId === "from" ? "novel" : "anthology" },
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

		assertExitFails(
			exit,
			new UserStateBadRequest({
				reason: { code: "identity-property-mismatch", property: "kind" },
			}),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("moves events and relationships when the schema has no merge identity metadata", () => {
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
					sourceEntitySchemaSlug: null,
					targetEntitySchemaSlug: null,
					propertiesSchema: { fields: {} },
					id: RelationshipSchemaSlug.make("relationship-schema"),
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
						relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
					},
					{
						properties: {},
						createdAt: "2026-01-01T00:00:00.000Z",
						targetEntityId: EntityId.make("from"),
						id: RelationshipId.make("relationship-2"),
						sourceEntityId: EntityId.make("target-2"),
						relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
					},
					{
						properties: {},
						createdAt: "2026-01-01T00:00:00.000Z",
						sourceEntityId: EntityId.make("from"),
						targetEntityId: EntityId.make("from"),
						id: RelationshipId.make("relationship-3"),
						relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema"),
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
						relationshipSchemaSlug: input.relationshipSchemaSlug,
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
						relationshipSchemaSlug: input.relationshipSchemaSlug,
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
