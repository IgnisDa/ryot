import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import { EntityId, EntitySchemaId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { RedisService } from "#lib/redis";
import type { MockOverrides } from "#lib/test-support/effect";
import {
	dbRunnerLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";
import { CollectionsService } from "#modules/collections/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityImportPayload } from "#modules/entity-import/entity-import-workflow";
import {
	EntityImportWorkflowOperations,
	type EntityImportWorkflowOperationsValue,
} from "#modules/entity-import/operations-workflow";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { runLibraryEntityImportWorkflow } from "./library-entity-import-workflow";

const TestLibraryEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "TestLibraryEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const now = "2026-06-14T00:00:00.000Z";

const populatedEntity = {
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	name: "Test Book",
	externalId: "ext-1",
	sandboxScriptId: null,
	id: EntityId.make("entity-1"),
	properties: { title: "Test Book" },
	entitySchemaId: EntitySchemaId.make("schema-1"),
} satisfies ListedEntity;

const importPayload = {
	externalId: "ext-1",
	executionId: "exec-1",
	userId: UserId.make("user-1"),
	scriptId: SandboxScriptId.make("script-1"),
	entitySchemaId: EntitySchemaId.make("schema-1"),
} satisfies EntityImportPayload;

const mockEntitiesService = Layer.mock(EntitiesService);
const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockCollectionsService = Layer.mock(CollectionsService);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		findGlobalEntityByExternalId: () => Effect.succeed(populatedEntity),
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeEntitiesService = (overrides: MockOverrides<typeof mockEntitiesService> = {}) =>
	mockEntitiesService({ ...overrides, _tag: "EntitiesService" });

const makeCollectionsService = (overrides: MockOverrides<typeof mockCollectionsService> = {}) =>
	mockCollectionsService({ ...overrides, _tag: "CollectionsService" });

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) => mockRelationshipsRepository({ ...overrides, _tag: "RelationshipsRepository" });

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) => mockEntitySchemasRepository({ ...overrides, _tag: "EntitySchemasRepository" });

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) => mockRelationshipSchemasRepository({ ...overrides, _tag: "RelationshipSchemasRepository" });

type TestLayerOptions = {
	entitiesService?: Layer.Layer<EntitiesService>;
	collectionsService?: Layer.Layer<CollectionsService>;
	entitiesRepository?: Layer.Layer<EntitiesRepository>;
	processSandbox?: EntityImportWorkflowOperationsValue["processSandbox"];
};

const makeTestLayer = (options: TestLayerOptions) => {
	const relationshipsRepository = makeRelationshipsRepository();

	const relationshipsServiceLayer = RelationshipsService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, relationshipsRepository)),
	);

	return Layer.mergeAll(
		dbRunnerLayer,
		relationshipsServiceLayer,
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(0) })),
		Layer.mock(EntityImportWorkflowOperations, {
			processSandbox: options.processSandbox ?? (() => Effect.die("unused")),
		}),
		options.collectionsService ?? makeCollectionsService(),
		options.entitiesService ?? makeEntitiesService(),
		options.entitiesRepository ?? makeEntitiesRepository(),
		makeEntitySchemasRepository(),
		relationshipsRepository,
		makeRelationshipSchemasRepository(),
	);
};

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(TestLibraryEntityImportWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

it.effect("ensures library membership after a successful import", () => {
	let ensuredCall: { userId: string; entityId: string } | undefined;

	const options = {
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: (userId, entityId) => {
				ensuredCall = { userId, entityId };
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		importPayload.executionId,
		Effect.gen(function* () {
			const entity = yield* runLibraryEntityImportWorkflow(
				importPayload,
				importPayload.executionId,
			);

			expect(entity.id).toBe("entity-1");
			expect(ensuredCall).toEqual({ userId: "user-1", entityId: "entity-1" });
		}),
	);
});

it.effect("dies when the payload has no userId", () => {
	let ensureCalled = false;

	const options = {
		collectionsService: makeCollectionsService({
			ensureEntityInLibrary: () => {
				ensureCalled = true;
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	const payload = { ...importPayload, userId: null };

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runLibraryEntityImportWorkflow(payload, payload.executionId));

			expect(ensureCalled).toBe(false);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure" && exit.cause._tag === "Die") {
				expect(exit.cause.defect).toBe("LibraryEntityImportWorkflow: userId is required");
			}
		}),
	);
});
