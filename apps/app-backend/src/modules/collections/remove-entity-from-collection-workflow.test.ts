import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { DbError, NotFound } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaId,
	EventSchemaId,
	RelationshipId,
	RelationshipSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import {
	type MockOverrides,
	dbRunnerLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
	transactionLayer,
} from "#lib/test-support/effect";
import { EntitiesService } from "#modules/entities/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import {
	RemoveEntityFromCollectionWorkflow,
	type RemoveEntityFromCollectionWorkflowPayload,
} from "./remove-entity-from-collection-workflow";
import { runRemoveEntityFromCollectionWorkflow } from "./remove-entity-from-collection-workflow-live";
import { CollectionsRepository } from "./repository";
import { CollectionsService } from "./service";

const now = "2026-06-14T00:00:00.000Z";
const userId = UserId.make("user-id");
const entityId = EntityId.make("entity-id");
const collectionId = EntityId.make("coll-id");

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

const collectionEntitySchema = {
	id: EntitySchemaId.make("collection-schema-id"),
	entitySchemaId: EntitySchemaId.make("collection-schema-id"),
	propertiesSchema: { fields: {}, unknownKeys: "passthrough" as const },
};

const removeEventSchema = {
	name: "Remove Entity from Collection",
	slug: "remove-entity-from-collection",
	id: EventSchemaId.make("remove-event-schema-id"),
};

const deletedMembership = {
	createdAt: now,
	sourceEntityId: entityId,
	properties: { note: "kept" },
	targetEntityId: collectionId,
	id: RelationshipId.make("rel-id"),
	relationshipSchemaId: RelationshipSchemaId.make("member-of-schema-id"),
};

const collectionRow = {
	name: "Coll",
	createdAt: now,
	updatedAt: now,
	properties: {},
	externalId: null,
	id: collectionId,
	sandboxScriptId: null,
	entitySchemaId: EntitySchemaId.make("collection-schema-id"),
};

const entityRow = { id: entityId, userId, entitySchemaSlug: "book" };

const mockCollectionsRepository = Layer.mock(CollectionsRepository);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);

const makeLayer = (
	relationshipOverrides: MockOverrides<typeof mockRelationshipsRepository> = {},
	collectionOverrides: MockOverrides<typeof mockCollectionsRepository> = {},
) => {
	const relationshipsRepository = mockRelationshipsRepository({
		_tag: "RelationshipsRepository",
		deleteUserRelationship: () => Effect.succeed(deletedMembership),
		...relationshipOverrides,
	});

	const collectionsRepository = mockCollectionsRepository({
		_tag: "CollectionsRepository",
		getCollectionById: () => Effect.succeed(collectionRow),
		getEntityForMembership: () => Effect.succeed(entityRow),
		findBuiltinEventSchemaBySlug: () => Effect.succeed(removeEventSchema),
		getBuiltinCollectionSchema: () => Effect.succeed(collectionEntitySchema),
		...collectionOverrides,
	});

	// getOrCreateCollection is the only path that touches EntitiesService and is not exercised here.
	const entitiesServiceLayer = Layer.mock(EntitiesService)({ _tag: "EntitiesService" });

	const relationshipsServiceLayer = RelationshipsService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, relationshipsRepository)),
	);

	const relationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository)({
		_tag: "RelationshipSchemasRepository",
		findBuiltinBySlug: (slug: string) =>
			slug === "member-of" ? Effect.succeed(memberOfSchema) : Effect.succeed(inLibrarySchema),
	});

	return CollectionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				entitiesServiceLayer,
				relationshipsRepository,
				collectionsRepository,
				relationshipsServiceLayer,
				relationshipSchemasRepository,
				Layer.succeed(WorkflowEngine, makeWorkflowEngine()),
			),
		),
	);
};

type CapturedDispatch = { executionId: string; payload: unknown };

const runRemoveWorkflow = (input: {
	layer: Layer.Layer<CollectionsService>;
	dispatches?: CapturedDispatch[];
	execute?: (
		...args: Parameters<WorkflowEngine["Type"]["execute"]>
	) => Effect.Effect<unknown, unknown>;
}) => {
	const executionId = "remove-workflow-execution-id";
	const instance = WorkflowInstance.initial(RemoveEntityFromCollectionWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance, {
		execute:
			input.execute ??
			((_workflow, options) => {
				input.dispatches?.push({ executionId: options.executionId, payload: options.payload });
				return Effect.succeed(options.executionId);
			}),
	});
	const payload = {
		userId,
		entityId,
		executionId,
		collectionId,
	} satisfies RemoveEntityFromCollectionWorkflowPayload;

	return runRemoveEntityFromCollectionWorkflow(payload).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(input.layer),
	);
};

it.effect("dispatches one EventCreateWorkflow child on a successful delete", () => {
	const dispatches: CapturedDispatch[] = [];

	return Effect.gen(function* () {
		const result = yield* runRemoveWorkflow({ layer: makeLayer(), dispatches });

		expect(result.memberOf.id).toBe("rel-id");
		expect(dispatches).toHaveLength(1);
		expect(dispatches[0]?.executionId).toBe("collection-membership-removed-rel-id");
		expect(dispatches[0]?.payload).toMatchObject({
			origin: "collection",
			executionId: "collection-membership-removed-rel-id",
			userId,
			payload: [
				{
					entityId: collectionId,
					eventSchemaId: "remove-event-schema-id",
					properties: {
						entityId,
						relationshipId: "rel-id",
						entitySchemaSlug: "book",
						relationshipProperties: { note: "kept" },
					},
				},
			],
		});
	});
});

it.effect("dispatches nothing when there is no remove event schema", () => {
	const dispatches: CapturedDispatch[] = [];
	const layer = makeLayer({}, { findBuiltinEventSchemaBySlug: () => Effect.succeed(null) });

	return Effect.gen(function* () {
		const result = yield* runRemoveWorkflow({ layer, dispatches });

		expect(result.memberOf.id).toBe("rel-id");
		expect(dispatches).toHaveLength(0);
	});
});

it.effect("propagates NotFound when the entity is not in the collection", () => {
	const layer = makeLayer({ deleteUserRelationship: () => Effect.succeed(null) });

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(runRemoveWorkflow({ layer }));

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Entity is not in collection" })));
	});
});

it.effect("propagates a dispatch admission failure without swallowing it", () => {
	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			runRemoveWorkflow({
				layer: makeLayer(),
				execute: () => Effect.fail(new DbError({ message: "boom" })),
			}),
		);

		expect(exit._tag).toBe("Failure");
	});
});

it.effect("produces an identical child execution id when the body replays", () => {
	const first: CapturedDispatch[] = [];
	const second: CapturedDispatch[] = [];

	return Effect.gen(function* () {
		yield* runRemoveWorkflow({ layer: makeLayer(), dispatches: first });
		yield* runRemoveWorkflow({ layer: makeLayer(), dispatches: second });

		expect(first[0]?.executionId).toBe("collection-membership-removed-rel-id");
		expect(second[0]?.executionId).toBe(first[0]?.executionId);
	});
});
