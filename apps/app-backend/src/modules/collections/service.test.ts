import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import {
	type MockOverrides,
	dbRunnerLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-utils/effect";
import { LifecycleDispatchNoop } from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { QueryEngineService } from "#modules/query-engine/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import { runAddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow-live";
import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";

const user: CurrentUserValue = {
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-id"),
	preferences: { isNsfw: false, language: null, disableIntegrations: false },
};

const memberOfSchema = {
	isBuiltin: true,
	slug: "member-of",
	name: "Member Of",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	id: RelationshipSchemaSlug.make("member-of-schema-id"),
	propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
};

const inLibrarySchema = {
	isBuiltin: true,
	slug: "in-library",
	name: "In Library",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("in-library-schema-id"),
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
	id: EntitySchemaSlug.make("collection-schema-id"),
	entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
};

const addEventSchema = {
	name: "Add Entity to Collection",
	slug: "add-entity-to-collection",
	id: EventSchemaSlug.make("add-event-schema-id"),
	propertiesSchema: { fields: {} },
};

const removeEventSchema = {
	name: "Remove Entity from Collection",
	slug: "remove-entity-from-collection",
	id: EventSchemaSlug.make("remove-event-schema-id"),
	propertiesSchema: { fields: {} },
};

const mockCollectionsRepository = Layer.mock(CollectionsRepository);

const makeCollectionsRepository = (
	overrides: MockOverrides<typeof mockCollectionsRepository> = {},
) =>
	mockCollectionsRepository({
		_tag: "CollectionsRepository",
		getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
		findBuiltinEventSchemaBySlug: (_entitySchemaSlug, slug) =>
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
				id: EntitySchemaSlug.make("collection-schema-id"),
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
		create: () => Effect.succeed({ count: 1, outcomes: [], failure: null }),
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
		workflowEngine?: WorkflowEngine["Type"];
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
			Layer.mergeAll(dbRunnerLayer, LifecycleDispatchNoop, makeQueryEngine(), entitiesRepository),
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
				Layer.succeed(WorkflowEngine, options.workflowEngine ?? makeWorkflowEngine()),
			),
		),
	);
};

type CapturedDispatch = { executionId: string; payload: unknown };

const runAddWorkflow = (input: {
	entityId: EntityId;
	collectionId: EntityId;
	properties?: unknown;
	dispatches?: CapturedDispatch[];
	layer: Layer.Layer<CollectionsService>;
}) => {
	const executionId = "add-workflow-execution-id";
	const instance = WorkflowInstance.initial(AddEntityToCollectionWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			input.dispatches?.push({ executionId: options.executionId, payload: options.payload });
			return Effect.succeed(options.executionId);
		},
	});
	return runAddEntityToCollectionWorkflow(
		{
			executionId,
			userId: user.id,
			entityId: input.entityId,
			properties: input.properties,
			collectionId: input.collectionId,
		},
		executionId,
	).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(input.layer),
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
			insertEntity: () => {
				created = true;
				return Effect.succeed({
					wasInserted: true,
					entity: {
						createdAt: now,
						updatedAt: now,
						externalId: null,
						name: "Favorites",
						populatedAt: null,
						sandboxScriptId: null,
						id: EntityId.make("collection-id"),
						properties: { description: "My favorites" },
						entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
					},
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
		const exit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				entityId: EntityId.make("same-id"),
				collectionId: EntityId.make("same-id"),
			}),
		);

		expect(exit).toEqual(
			Exit.fail(new BadRequest({ message: "Cannot add a collection to itself" })),
		);
	});
});

it.effect("returns not found when collection does not exist for user", () => {
	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getCollectionById: () => Effect.succeed(null),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("missing-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Collection not found" })));
	});
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
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				entityId: EntityId.make("missing-id"),
				collectionId: EntityId.make("coll-id"),
			}),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity not found" })));
	});
});

it.effect("dispatches EventCreateWorkflow only on first add, not on upsert", () => {
	const dispatches: CapturedDispatch[] = [];

	const membership = {
		createdAt: now,
		properties: {},
		wasInserted: true,
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
	};

	const layer = makeServiceLayer({
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
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () => Effect.succeed(membership),
		}),
	});

	return Effect.gen(function* () {
		yield* runAddWorkflow({
			layer,
			dispatches,
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(dispatches).toHaveLength(1);
		expect(dispatches[0]?.executionId).toBe("collection-membership-added-rel-id");
	});
});

it.effect("does not dispatch EventCreateWorkflow on upsert update", () => {
	const dispatches: CapturedDispatch[] = [];

	const membership = {
		createdAt: now,
		properties: {},
		wasInserted: false,
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
	};

	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () => Effect.succeed(membership),
			updateRelationship: () => Effect.succeed(membership),
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
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		yield* runAddWorkflow({
			layer,
			dispatches,
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(dispatches).toHaveLength(0);
	});
});

it.effect("returns not found when removing entity not in collection", () => {
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			deleteRelationship: () => Effect.succeed(null),
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
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
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
	let capturedExecutionId: string | undefined;

	const deletedMembership = {
		createdAt: now,
		properties: {},
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
	};
	const eventsService = makeEventsService({
		create: (input) => {
			queuedEventCount++;
			capturedExecutionId = input.executionId;
			return Effect.succeed({ count: 1, outcomes: [], failure: null });
		},
	});

	const layer = makeServiceLayer({
		eventsService,
		relationshipsRepository: makeRelationshipsRepository({
			deleteRelationship: () => Effect.succeed(deletedMembership),
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
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
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
		expect(capturedExecutionId).toBe("collection-membership-removed-rel-id");
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
			updateRelationship: (input: { properties: Record<string, unknown> }) => {
				upserted = input;
				return Effect.succeed({
					createdAt: now,
					wasInserted: true,
					properties: input.properties,
					id: RelationshipId.make("rel-id"),
					sourceEntityId: EntityId.make("entity-id"),
					targetEntityId: EntityId.make("library-entity-id"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("in-library-schema-id"),
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

it.effect("merges ownership sources after a create conflict", () => {
	let retried: { properties: Record<string, unknown> } | undefined;
	const layer = makeServiceLayer({
		collectionsRepository: makeCollectionsRepository({
			getUserLibraryEntityId: () => Effect.succeed(EntityId.make("library-entity-id")),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			findRelationshipProperties: () => Effect.succeed(null),
			createRelationship: () =>
				Effect.succeed({
					createdAt: now,
					wasInserted: false,
					properties: { owned: true, ownershipSources: ["plex_yank"] },
					id: RelationshipId.make("rel-id"),
					sourceEntityId: EntityId.make("entity-id"),
					targetEntityId: EntityId.make("library-entity-id"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("in-library-schema-id"),
				}),
			updateRelationship: (input: { properties: Record<string, unknown> }) => {
				retried = input;
				return Effect.succeed({
					createdAt: now,
					wasInserted: false,
					properties: input.properties,
					id: RelationshipId.make("rel-id"),
					sourceEntityId: EntityId.make("entity-id"),
					targetEntityId: EntityId.make("library-entity-id"),
					relationshipSchemaSlug: RelationshipSchemaSlug.make("in-library-schema-id"),
				});
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		yield* service.markEntityOwnedInLibrary({
			syncedAt: now,
			userId: user.id,
			provider: "komga",
			entityId: EntityId.make("entity-id"),
		});

		expect(retried?.properties).toEqual({
			owned: true,
			ownershipSources: ["plex_yank", "komga"],
			ownershipSyncedAt: now,
		});
	}).pipe(Effect.provide(layer));
});
