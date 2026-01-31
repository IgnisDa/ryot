import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { BadRequest, NotFound } from "#lib/errors";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "#lib/schema/brands";
import type { AppSchema } from "#lib/schema/property-schema";
import { type MockOverrides, dbRunnerLayer, transactionLayer } from "#lib/test-support/effect";
import { EntityPopulationTriggerNoop } from "#modules/entities/population-trigger";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { TranslationOverlayNoop } from "#modules/entities/translation-overlay";
import { EventsService } from "#modules/events/service";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user: CurrentUserValue = {
	id: UserId.make("user-id"),
	name: "Test User",
	email: "user@example.com",
};

const memberOfSchema = {
	isBuiltin: true,
	slug: "member-of",
	name: "Member Of",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	id: RelationshipSchemaId.make("member-of-schema-id"),
	propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
};

const inLibrarySchema = {
	isBuiltin: true,
	slug: "in-library",
	name: "In Library",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaId.make("in-library-schema-id"),
};

const collectionPropertiesSchema = {
	fields: {
		description: { label: "Description", type: "string" as const, description: "Description" },
		membershipPropertiesSchema: {
			type: "object" as const,
			properties: {},
			unknownKeys: "passthrough" as const,
			label: "Membership Properties Schema",
			description: "Membership Properties Schema",
		},
	},
} satisfies AppSchema;

const collectionEntitySchema = {
	propertiesSchema: collectionPropertiesSchema,
	id: EntitySchemaId.make("collection-schema-id"),
	entitySchemaId: EntitySchemaId.make("collection-schema-id"),
};

const addEventSchema = {
	name: "Add Entity to Collection",
	slug: "add-entity-to-collection",
	id: EventSchemaId.make("add-event-schema-id"),
};

const removeEventSchema = {
	name: "Remove Entity from Collection",
	slug: "remove-entity-from-collection",
	id: EventSchemaId.make("remove-event-schema-id"),
};

const mockCollectionsRepository = Layer.mock(CollectionsRepository);

const makeCollectionsRepository = (
	overrides: MockOverrides<typeof mockCollectionsRepository> = {},
) =>
	mockCollectionsRepository({
		_tag: "CollectionsRepository",
		getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
		findBuiltinEventSchemaBySlug: (_entitySchemaId, slug) =>
			slug === "add-entity-to-collection"
				? Effect.succeed(addEventSchema)
				: Effect.succeed(removeEventSchema),
		...overrides,
	});

const mockEntitiesRepository = Layer.mock(EntitiesRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		_tag: "EntitiesRepository",
		getEntitySchemaScopeForUser: () =>
			Effect.succeed({
				userId: null,
				isBuiltin: true,
				slug: "collection",
				id: EntitySchemaId.make("collection-schema-id"),
				propertiesSchema: collectionEntitySchema.propertiesSchema,
			}),
		...overrides,
	});

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) => mockRelationshipsRepository({ _tag: "RelationshipsRepository", ...overrides });

const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		_tag: "RelationshipSchemasRepository",
		findBuiltinBySlug: (slug: string) =>
			slug === "member-of" ? Effect.succeed(memberOfSchema) : Effect.succeed(inLibrarySchema),
		...overrides,
	});

const mockEventsService = Layer.mock(EventsService);

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		_tag: "EventsService",
		create: () => Effect.succeed({ count: 1 }),
		...overrides,
	});

const mockQueryEngine = Layer.mock(QueryEngineService);

const makeQueryEngine = (overrides: MockOverrides<typeof mockQueryEngine> = {}) =>
	mockQueryEngine({
		_tag: "QueryEngineService",
		validate: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeServiceLayer = (
	options: {
		eventsService?: ReturnType<typeof makeEventsService>;
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		collectionsRepository?: ReturnType<typeof makeCollectionsRepository>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
		relationshipSchemasRepository?: ReturnType<typeof makeRelationshipSchemasRepository>;
	} = {},
) => {
	const entitiesRepository = options.entitiesRepository ?? makeEntitiesRepository();
	const relationshipsRepository = options.relationshipsRepository ?? makeRelationshipsRepository();

	const entitiesServiceLayer = EntitiesService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				makeQueryEngine(),
				entitiesRepository,
				TranslationOverlayNoop,
				EntityPopulationTriggerNoop,
			),
		),
	);

	const relationshipsServiceLayer = RelationshipsService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, relationshipsRepository)),
	);

	return CollectionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				entitiesServiceLayer,
				relationshipsRepository,
				relationshipsServiceLayer,
				options.eventsService ?? makeEventsService(),
				options.collectionsRepository ?? makeCollectionsRepository(),
				options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
			),
		),
	);
};

it.effect("rejects creating a collection with an empty name", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(service.create(user, { name: "  " }));

		expect(exit).toEqual(Exit.fail(new BadRequest({ message: "Collection name is required" })));
	}).pipe(Effect.provide(layer));
});

it.effect("rejects creating a collection with invalid membershipPropertiesSchema", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.create(user, {
				name: "My Collection",
				membershipPropertiesSchema: { fields: { x: { type: "invalid_type" } } },
			}),
		);

		const errorMessage = exit.pipe(
			Exit.match({
				onSuccess: () => Option.none(),
				onFailure: (cause) =>
					Cause.failureOption(cause).pipe(
						Option.map((e) => (e as { message?: string }).message ?? ""),
					),
			}),
		);

		expect(Option.isSome(errorMessage)).toBe(true);
		expect(Option.getOrNull(errorMessage)).toContain(
			"membershipPropertiesSchema must be a valid AppSchema",
		);
	}).pipe(Effect.provide(layer));
});

it.effect("creates a collection with valid inputs", () => {
	let created = false;

	const layer = makeServiceLayer({
		entitiesRepository: makeEntitiesRepository({
			saveEntity: () => {
				created = true;
				return Effect.succeed({
					createdAt: now,
					updatedAt: now,
					externalId: null,
					name: "Favorites",
					populatedAt: null,
					sandboxScriptId: null,
					id: EntityId.make("collection-id"),
					properties: { description: "My favorites" },
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const result = yield* service.create(user, { name: "Favorites", description: "My favorites" });

		expect(created).toBe(true);
		expect(result.name).toBe("Favorites");
		expect(result.id).toBe("collection-id");
	}).pipe(Effect.provide(layer));
});

it.effect("rejects adding a collection to itself", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, {
				entityId: EntityId.make("same-id"),
				collectionId: EntityId.make("same-id"),
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot add a collection to itself" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when collection does not exist for user", () => {
	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getCollectionById: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, {
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("missing-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Collection not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when entity does not exist", () => {
	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () => Effect.succeed(null),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					id: EntityId.make("coll-id"),
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.addToCollection(user, {
				entityId: EntityId.make("missing-id"),
				collectionId: EntityId.make("coll-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	}).pipe(Effect.provide(layer));
});

it.effect("creates membership event only on first add, not on upsert", () => {
	let queuedEventCount = 0;

	const membership = {
		createdAt: now,
		properties: {},
		wasInserted: true,
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaId: RelationshipSchemaId.make("member-of-schema-id"),
	};
	const eventsService = makeEventsService({
		create: () => {
			queuedEventCount++;
			return Effect.succeed({ count: 1 });
		},
	});

	const layer = makeServiceLayer({
		eventsService,
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({
					userId: user.id,
					entitySchemaSlug: "book",
					id: EntityId.make("entity-id"),
				}),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					id: EntityId.make("coll-id"),
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			saveRelationship: () => Effect.succeed(membership),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, {
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(queuedEventCount).toBe(1);
	}).pipe(Effect.provide(layer));
});

it.effect("does not create membership event on upsert update", () => {
	let queuedEventCount = 0;

	const membership = {
		createdAt: now,
		properties: {},
		wasInserted: false,
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaId: RelationshipSchemaId.make("member-of-schema-id"),
	};
	const eventsService = makeEventsService({
		create: () => {
			queuedEventCount++;
			return Effect.succeed({ count: 1 });
		},
	});

	const layer = makeServiceLayer({
		eventsService,
		relationshipsRepository: makeRelationshipsRepository({
			saveRelationship: () => Effect.succeed(membership),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({
					userId: user.id,
					entitySchemaSlug: "book",
					id: EntityId.make("entity-id"),
				}),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					id: EntityId.make("coll-id"),
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.addToCollection(user, {
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(queuedEventCount).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when removing entity not in collection", () => {
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			deleteUserRelationship: () => Effect.succeed(null),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({
					userId: user.id,
					entitySchemaSlug: "book",
					id: EntityId.make("entity-id"),
				}),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					id: EntityId.make("coll-id"),
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(
			service.removeFromCollection(user, {
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity is not in collection" })));
	}).pipe(Effect.provide(layer));
});

it.effect("creates remove event on successful membership deletion", () => {
	let queuedEventCount = 0;

	const deletedMembership = {
		createdAt: now,
		properties: {},
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaId: RelationshipSchemaId.make("member-of-schema-id"),
	};
	const eventsService = makeEventsService({
		create: () => {
			queuedEventCount++;
			return Effect.succeed({ count: 1 });
		},
	});

	const layer = makeServiceLayer({
		eventsService,
		relationshipsRepository: makeRelationshipsRepository({
			deleteUserRelationship: () => Effect.succeed(deletedMembership),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({
					userId: user.id,
					entitySchemaSlug: "book",
					id: EntityId.make("entity-id"),
				}),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					sandboxScriptId: null,
					id: EntityId.make("coll-id"),
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const result = yield* service.removeFromCollection(user, {
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(queuedEventCount).toBe(1);
		expect(result.memberOf.id).toBe("rel-id");
	}).pipe(Effect.provide(layer));
});

it.effect("merges ownership sources when marking an entity owned in the library", () => {
	let upserted: { properties: Record<string, unknown> } | undefined;

	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getUserLibraryEntityId: () => Effect.succeed(EntityId.make("library-entity-id")),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			findRelationshipProperties: () =>
				Effect.succeed({ owned: true, ownershipSources: ["plex_yank"] }),
			saveRelationship: (input: { properties: Record<string, unknown> }) => {
				upserted = input;
				return Effect.succeed({
					createdAt: now,
					wasInserted: true,
					properties: input.properties,
					id: RelationshipId.make("rel-id"),
					sourceEntityId: EntityId.make("entity-id"),
					targetEntityId: EntityId.make("library-entity-id"),
					relationshipSchemaId: RelationshipSchemaId.make("in-library-schema-id"),
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.markEntityOwnedInLibrary({
			syncedAt: now,
			provider: "komga",
			userId: UserId.make("user-id"),
			entityId: EntityId.make("entity-id"),
		});

		expect(upserted?.properties).toEqual({
			owned: true,
			ownershipSyncedAt: now,
			ownershipSources: ["plex_yank", "komga"],
		});
	}).pipe(Effect.provide(layer));
});
