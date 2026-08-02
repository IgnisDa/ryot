import { expect, it } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
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
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { assertExitFails } from "#lib/test-utils/assertions";
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
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { RyotQLService } from "#modules/ryotql/service";

import { AddEntityToCollectionWorkflow } from "./add-entity-to-collection-workflow";
import {
	AddEntityToCollectionWorkflowOperationsLive,
	runAddEntityToCollectionWorkflow,
} from "./add-entity-to-collection-workflow-live";
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
) => mockRelationshipsRepository({ ...overrides });

const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		findBuiltinBySlug: () => Effect.succeed(memberOfSchema),
		...overrides,
	});

const mockEventsService = Layer.mock(EventsService);

const makeEventsService = (overrides: MockOverrides<typeof mockEventsService> = {}) =>
	mockEventsService({
		create: () => Effect.succeed({ count: 1, outcomes: [], failure: null }),
		...overrides,
	});

const mockRyotQL = Layer.mock(RyotQLService);

const makeRyotQL = (overrides: MockOverrides<typeof mockRyotQL> = {}) => mockRyotQL(overrides);

const makeServiceLayer = (
	options: {
		eventsService?: ReturnType<typeof makeEventsService>;
		workflowEngine?: WorkflowEngine["Service"];
		entitiesRepository?: ReturnType<typeof makeEntitiesRepository>;
		collectionsRepository?: ReturnType<typeof makeCollectionsRepository>;
		relationshipsRepository?: ReturnType<typeof makeRelationshipsRepository>;
		relationshipSchemasRepository?: ReturnType<typeof makeRelationshipSchemasRepository>;
	} = {},
) => {
	const entitiesRepository = options.entitiesRepository ?? makeEntitiesRepository();
	const relationshipsRepository = options.relationshipsRepository ?? makeRelationshipsRepository();

	const entitiesServiceLayer = EntitiesService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(dbRunnerLayer, LifecycleDispatchNoop, makeRyotQL(), entitiesRepository),
		),
	);

	const relationshipsServiceLayer = RelationshipsService.layer.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, relationshipsRepository)),
	);

	return CollectionsService.layer.pipe(
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

type CapturedDispatch = { executionId: string; payload: unknown; discard: boolean | undefined };

const runAddWorkflow = (input: {
	entityId: EntityId;
	executionId?: string;
	properties?: unknown;
	eventError?: unknown;
	eventResult?: unknown;
	collectionId: EntityId;
	eventResults?: unknown[];
	dispatches?: CapturedDispatch[];
	layer: Layer.Layer<CollectionsService>;
}) => {
	const executionId = input.executionId ?? "add-workflow-execution-id";
	const instance = WorkflowInstance.initial(AddEntityToCollectionWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (_workflow, options) => {
			input.dispatches?.push({
				discard: options.discard,
				payload: options.payload,
				executionId: options.executionId,
			});
			return input.eventError
				? Effect.fail(input.eventError)
				: Effect.succeed(input.eventResults?.shift() ?? input.eventResult ?? options.executionId);
		},
	});
	const operations = AddEntityToCollectionWorkflowOperationsLive.pipe(Layer.provide(input.layer));
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
		Effect.provide(operations),
	);
};

it.effect("rejects creating a collection with an empty name", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* CollectionsService;
		const exit = yield* Effect.exit(service.create(user, { name: "  " }));

		assertExitFails(exit, new BadRequest({ message: "Collection name is required" }));
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
					Cause.findErrorOption(cause).pipe(
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
						providerId: null,
						name: "Favorites",
						populatedAt: null,
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

		assertExitFails(exit, new BadRequest({ message: "Cannot add a collection to itself" }));
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

		assertExitFails(exit, new NotFound({ message: "Collection not found" }));
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
					providerId: null,
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

		assertExitFails(exit, new NotFound({ message: "Entity not found" }));
	});
});

it.effect("awaits EventCreateWorkflow for a newly inserted membership", () => {
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
					providerId: null,
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
		expect(dispatches[0]?.discard).toBeUndefined();
		expect(dispatches[0]?.executionId).toBe("collection-membership-added-rel-id");
	});
});

it.effect("awaits the same stable child for existing membership calls without compensating", () => {
	const dispatches: CapturedDispatch[] = [];
	let compensationCalls = 0;

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
			deleteUserRelationshipById: () => {
				compensationCalls += 1;
				return Effect.succeed(true);
			},
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
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		yield* runAddWorkflow({
			layer,
			dispatches,
			executionId: "existing-call-1",
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});
		yield* runAddWorkflow({
			layer,
			dispatches,
			executionId: "existing-call-2",
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(dispatches.map(({ executionId }) => executionId)).toEqual([
			"collection-membership-added-rel-id",
			"collection-membership-added-rel-id",
		]);
		expect(compensationCalls).toBe(0);
	});
});

it.effect("compensates a newly inserted membership when the awaited policy fails", () => {
	const compensations: Array<{ userId: UserId; relationshipId: RelationshipId }> = [];
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
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () => Effect.succeed(membership),
			deleteUserRelationshipById: (userId, relationshipId) =>
				Effect.sync(() => {
					compensations.push({ userId, relationshipId });
					return true;
				}),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ userId: null, entitySchemaSlug: "book", id: EntityId.make("entity-id") }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
				eventResult: {
					count: 0,
					outcomes: [],
					failure: { index: 0, reason: { kind: "bad_request", message: "policy failed" } },
				},
			}),
		);

		assertExitFails(exit, new BadRequest({ message: "policy failed" }));
		expect(compensations).toEqual([{ userId: user.id, relationshipId: "rel-id" }]);
	});
});

it.effect("compensates when child workflow execution fails", () => {
	const compensatedIds: RelationshipId[] = [];
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
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () => Effect.succeed(membership),
			deleteUserRelationshipById: (_userId, relationshipId) =>
				Effect.sync(() => {
					compensatedIds.push(relationshipId);
					return true;
				}),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ userId: null, entitySchemaSlug: "book", id: EntityId.make("entity-id") }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
				eventError: new NotFound({ message: "child failed" }),
			}),
		);

		assertExitFails(exit, new NotFound({ message: "child failed" }));
		expect(compensatedIds).toEqual(["rel-id"]);
	});
});

it.effect("compensates a non-inserting caller when the shared child fails", () => {
	const compensatedIds: RelationshipId[] = [];
	const membership = {
		createdAt: now,
		properties: {},
		wasInserted: false,
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		id: RelationshipId.make("other-request-rel-id"),
		relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
	};
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () => Effect.succeed(membership),
			updateRelationship: () => Effect.succeed(membership),
			deleteUserRelationshipById: (_userId, relationshipId) =>
				Effect.sync(() => {
					compensatedIds.push(relationshipId);
					return true;
				}),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ userId: null, entitySchemaSlug: "book", id: EntityId.make("entity-id") }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
				eventResult: {
					count: 0,
					outcomes: [],
					failure: { index: 0, reason: { kind: "bad_request", message: "policy failed" } },
				},
			}),
		);

		assertExitFails(exit, new BadRequest({ message: "policy failed" }));
		expect(compensatedIds).toEqual(["other-request-rel-id"]);
	});
});

it.effect("can insert and run policy again after a compensated failure", () => {
	let nextRelationship = 0;
	const dispatches: CapturedDispatch[] = [];
	const compensatedIds: RelationshipId[] = [];
	const membership = (id: RelationshipId, wasInserted: boolean) => ({
		id,
		wasInserted,
		createdAt: now,
		properties: {},
		targetEntityId: EntityId.make("coll-id"),
		sourceEntityId: EntityId.make("entity-id"),
		relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of-schema-id"),
	});
	let currentRelationship: ReturnType<typeof membership> | null = null;
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () =>
				Effect.sync(() => {
					if (currentRelationship) {
						return { ...currentRelationship, wasInserted: false };
					}
					nextRelationship += 1;
					currentRelationship = membership(RelationshipId.make(`rel-${nextRelationship}`), true);
					return currentRelationship;
				}),
			deleteUserRelationshipById: (requestedUserId, relationshipId) =>
				Effect.sync(() => {
					if (requestedUserId !== user.id || currentRelationship?.id !== relationshipId) {
						return false;
					}
					compensatedIds.push(relationshipId);
					currentRelationship = null;
					return true;
				}),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ userId: null, entitySchemaSlug: "book", id: EntityId.make("entity-id") }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});
	const eventResults = [
		{
			count: 0,
			outcomes: [],
			failure: { index: 0, reason: { kind: "bad_request", message: "policy failed" } },
		},
		{ count: 1, outcomes: [{ index: 0, status: "written", eventId: "event-1" }], failure: null },
	];

	return Effect.gen(function* () {
		const firstExit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				dispatches,
				eventResults,
				executionId: "first-add-execution",
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
			}),
		);
		assertExitFails(firstExit, new BadRequest({ message: "policy failed" }));

		const retried = yield* runAddWorkflow({
			layer,
			dispatches,
			eventResults,
			executionId: "retry-add-execution",
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(retried.memberOf.id).toBe("rel-2");
		expect(compensatedIds).toEqual(["rel-1"]);
		expect(dispatches.map(({ executionId }) => executionId)).toEqual([
			"collection-membership-added-rel-1",
			"collection-membership-added-rel-2",
		]);
	});
});

it.effect("retries compensation after a prior compensation failure", () => {
	let deleteAttempts = 0;
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
	let currentRelationship: typeof membership | null = membership;
	const layer = makeServiceLayer({
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () => Effect.succeed(membership),
			updateRelationship: () => Effect.succeed({ ...membership, wasInserted: false }),
			deleteUserRelationshipById: (_userId, relationshipId) =>
				Effect.gen(function* () {
					deleteAttempts += 1;
					if (deleteAttempts === 1) {
						return yield* new DbError({ message: "compensation failed" });
					}
					if (currentRelationship?.id !== relationshipId) {
						return false;
					}
					currentRelationship = null;
					return true;
				}),
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ userId: null, entitySchemaSlug: "book", id: EntityId.make("entity-id") }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});
	const eventResults = [
		{
			count: 0,
			outcomes: [],
			failure: { index: 0, reason: { kind: "bad_request", message: "policy failed" } },
		},
		{
			count: 0,
			outcomes: [],
			failure: { index: 0, reason: { kind: "bad_request", message: "policy failed" } },
		},
	];

	return Effect.gen(function* () {
		const firstExit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				dispatches,
				eventResults,
				executionId: "first-call",
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
			}),
		);
		assertExitFails(firstExit, new DbError({ message: "compensation failed" }));

		const retryExit = yield* Effect.exit(
			runAddWorkflow({
				layer,
				dispatches,
				eventResults,
				executionId: "retry-call",
				entityId: EntityId.make("entity-id"),
				collectionId: EntityId.make("coll-id"),
			}),
		);

		assertExitFails(retryExit, new BadRequest({ message: "policy failed" }));
		expect(deleteAttempts).toBe(2);
		expect(currentRelationship).toBeNull();
		expect(dispatches.map(({ executionId }) => executionId)).toEqual([
			"collection-membership-added-rel-id",
			"collection-membership-added-rel-id",
		]);
	});
});

it.effect("writes only member-of for a global collection member", () => {
	const relationshipSchemaSlugs: RelationshipSchemaSlug[] = [];
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
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: (input) => {
				relationshipSchemaSlugs.push(input.relationshipSchemaSlug);
				return Effect.succeed(membership);
			},
		}),
		collectionsRepository: makeCollectionsRepository({
			getEntityForMembership: () =>
				Effect.succeed({ userId: null, entitySchemaSlug: "book", id: EntityId.make("entity-id") }),
			getCollectionById: () =>
				Effect.succeed({
					name: "Coll",
					createdAt: now,
					updatedAt: now,
					properties: {},
					externalId: null,
					providerId: null,
					id: EntityId.make("coll-id"),
					entitySchemaSlug: EntitySchemaSlug.make("collection-schema-id"),
				}),
		}),
	});

	return Effect.gen(function* () {
		yield* runAddWorkflow({
			layer,
			entityId: EntityId.make("entity-id"),
			collectionId: EntityId.make("coll-id"),
		});

		expect(relationshipSchemaSlugs).toEqual(["member-of-schema-id"]);
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
					providerId: null,
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

		assertExitFails(exit, new NotFound({ message: "Entity is not in collection" }));
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
					providerId: null,
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
