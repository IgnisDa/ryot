import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipId,
	RelationshipSchemaId,
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
} from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
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

const mockQueryEngine = Layer.mock(QueryEngineService);

const makeQueryEngine = (overrides: MockOverrides<typeof mockQueryEngine> = {}) =>
	mockQueryEngine({
		_tag: "QueryEngineService",
		validate: () => Effect.void.pipe(Effect.as(undefined)),
		...overrides,
	});

const makeServiceLayer = (
	options: {
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
		Layer.provide(Layer.mergeAll(dbRunnerLayer, makeQueryEngine(), entitiesRepository)),
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
	return runAddEntityToCollectionWorkflow({
		executionId,
		userId: user.id,
		entityId: input.entityId,
		properties: input.properties,
		collectionId: input.collectionId,
	}).pipe(
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

it.effect("creates a collection through the entity create workflow", () => {
	let capturedPayload: unknown;

	const listedEntity = {
		createdAt: now,
		updatedAt: now,
		externalId: null,
		name: "Favorites",
		populatedAt: null,
		sandboxScriptId: null,
		id: EntityId.make("collection-id"),
		properties: { description: "My favorites" },
		entitySchemaId: EntitySchemaId.make("collection-schema-id"),
	} satisfies ListedEntity;

	const layer = makeServiceLayer({
		workflowEngine: makeWorkflowEngine({
			execute: (_workflow, execOptions) => {
				capturedPayload = execOptions.payload;
				return Effect.succeed(listedEntity);
			},
		}),
	});

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const result = yield* service.create(user, { name: "Favorites", description: "My favorites" });

		expect(capturedPayload).toMatchObject({
			origin: { kind: "api" },
			body: {
				name: "Favorites",
				entitySchemaId: "collection-schema-id",
				properties: { description: "My favorites" },
			},
		});
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
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
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

const membershipOutcome = (operation: "create" | "update" | "noop") => ({
	operation,
	relationship: {
		createdAt: now,
		properties: {},
		wasInserted: operation === "create",
		id: RelationshipId.make("rel-id"),
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaId: RelationshipSchemaId.make("member-of-schema-id"),
	},
});

it.effect("dispatches EventCreateWorkflow only on first add, not on upsert", () => {
	const dispatches: CapturedDispatch[] = [];

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
					entitySchemaId: EntitySchemaId.make("collection-schema-id"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			saveRelationship: () => Effect.succeed(membershipOutcome("create")),
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

	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			saveRelationship: () => Effect.succeed(membershipOutcome("update")),
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
		yield* runAddWorkflow({
			layer,
			dispatches,
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(dispatches).toHaveLength(0);
	});
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
					operation: "create" as const,
					relationship: {
						createdAt: now,
						wasInserted: true,
						properties: input.properties,
						id: RelationshipId.make("rel-id"),
						sourceEntityId: EntityId.make("entity-id"),
						targetEntityId: EntityId.make("library-entity-id"),
						relationshipSchemaId: RelationshipSchemaId.make("in-library-schema-id"),
					},
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
