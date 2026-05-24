import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { CurrentDb, DbRunner } from "~/lib/db";
import { CollectionsService } from "~/modules/collections/service";
import { RelationshipSchemasRepository } from "~/modules/relationship-schemas/repository";

import { EntitiesRepository } from "./repository";
import type { ListedEntity } from "./schemas";
import { EntityImportWorkflow, runEntityImportWorkflow } from "./workflows";

const now = "2026-06-14T00:00:00.000Z";

const baseEntity = {
	image: null,
	createdAt: now,
	updatedAt: now,
	id: "entity-1",
	name: "Test Book",
	populatedAt: now,
	externalId: "ext-1",
	entitySchemaId: "schema-1",
	sandboxScriptId: "script-1",
	properties: { title: "Test Book" },
} satisfies ListedEntity;

const baseEntitySchema = {
	propertiesSchema: {
		fields: { title: { type: "string" as const, label: "Title", description: "Title" } },
	},
};

const dbRunnerLayer = Layer.succeed(DbRunner, <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.provideService(effect, CurrentDb, Object.create(null)),
);

const defaultEntitiesRepository = () =>
	Object.assign(Object.create(null), {
		_tag: "EntitiesRepository" as const,
		upsertEntityRelationship: () => Effect.void,
		createEntity: () => Effect.die("unused"),
		getByIdForUser: () => Effect.die("unused"),
		getEntityScopeById: () => Effect.die("unused"),
		insertRelationship: () => Effect.die("unused"),
		upsertRelationship: () => Effect.die("unused"),
		getEntityScopeForUser: () => Effect.die("unused"),
		deleteUserEventsForEntity: () => Effect.die("unused"),
		findRelationshipProperties: () => Effect.die("unused"),
		listMatchCandidatesBySchema: () => Effect.die("unused"),
		getEntitySchemaScopeForUser: () => Effect.die("unused"),
		findEntitySchemaScriptBySlug: () => Effect.succeed(null),
		findGlobalEntityByExternalId: () => Effect.succeed(null),
		findEntityByExternalIdForUser: () => Effect.die("unused"),
		findEntitySchemaById: () => Effect.succeed(baseEntitySchema),
		createOrUpdateGlobalEntity: () => Effect.succeed(baseEntity),
		deleteUserRelationshipsForEntity: () => Effect.die("unused"),
	});

const defaultRelationshipSchemasRepository = () =>
	Object.assign(Object.create(null), {
		findById: () => Effect.die("unused"),
		_tag: "RelationshipSchemasRepository" as const,
		findBuiltinBySlug: () => Effect.die("unused"),
		findGlobalBySchemaIds: () => Effect.succeed(null),
	});

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	Object.assign(Object.create(null), defaultEntitiesRepository(), overrides);

const makeRelationshipSchemasRepository = (
	overrides: Partial<RelationshipSchemasRepository> = {},
) => Object.assign(Object.create(null), defaultRelationshipSchemasRepository(), overrides);

const makeCollectionsService = (
	onEnsureEntityInLibrary: (userId: string, entityId: string) => Effect.Effect<void> = () =>
		Effect.void,
) =>
	Object.assign(Object.create(null), {
		_tag: "CollectionsService" as const,
		create: () => Effect.die("unused"),
		ensureEntityInLibrary: onEnsureEntityInLibrary,
		addToCollection: () => Effect.die("unused"),
		removeFromCollection: () => Effect.die("unused"),
		getOrCreateCollection: () => Effect.die("unused"),
		markEntityOwnedInLibrary: () => Effect.die("unused"),
		ensureLibraryEntityForUser: () => Effect.die("unused"),
	});

type TestLayerOptions = {
	entitiesRepository?: EntitiesRepository;
	collectionsService?: CollectionsService;
	relationshipSchemasRepository?: RelationshipSchemasRepository;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
		Layer.succeed(
			RelationshipSchemasRepository,
			options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
		),
		Layer.succeed(CollectionsService, options.collectionsService ?? makeCollectionsService()),
	);

const makeWorkflowEngine = (instance: WorkflowInstance["Type"]) => {
	let engine: WorkflowEngine["Type"];

	engine = {
		poll: () => Effect.die("unused"),
		resume: () => Effect.die("unused"),
		execute: () => Effect.die("unused"),
		register: () => Effect.die("unused"),
		interrupt: () => Effect.die("unused"),
		deferredDone: () => Effect.die("unused"),
		scheduleClock: () => Effect.die("unused"),
		deferredResult: () => Effect.die("unused"),
		activityExecute: (activity) =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(
					activity.execute.pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(WorkflowInstance, instance),
					),
				);

				return new Workflow.Complete({ exit });
			}),
	} as WorkflowEngine["Type"];

	return engine;
};

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
	const engine = makeWorkflowEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const importPayload = {
	userId: "user-1",
	externalId: "ext-1",
	scriptId: "script-1",
	executionId: "exec-1",
	entitySchemaId: "schema-1",
};

it.effect("populates entity, writes related entities, and ensures library membership", () => {
	let relationshipWritten = false;
	let globalEntityWritten = false;
	let relatedEntityWritten = false;
	let libraryMembershipUserId: string | undefined;
	let libraryMembershipEntityId: string | undefined;

	const relatedEntitySchemaScript = {
		entitySchemaId: "schema-person",
		sandboxScriptId: "person-script",
	};
	const relatedEntity = {
		image: null,
		id: "person-1",
		name: "Author",
		createdAt: now,
		updatedAt: now,
		properties: {},
		populatedAt: null,
		externalId: "person-ext-1",
		entitySchemaId: "schema-person",
		sandboxScriptId: "person-script-id",
	} satisfies ListedEntity;
	const relationshipSchema = {
		isBuiltin: true,
		id: "rel-schema-1",
		slug: "authored-by",
		name: "Authored By",
		propertiesSchema: { fields: {} },
		sourceEntitySchemaId: "schema-1",
		targetEntitySchemaId: "schema-person",
	};
	const payload = { ...importPayload, executionId: "exec-full" };
	const options = {
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () => Effect.succeed(relationshipSchema),
		}),
		collectionsService: makeCollectionsService((userId, entityId) => {
			libraryMembershipUserId = userId;
			libraryMembershipEntityId = entityId;
			return Effect.void;
		}),
		entitiesRepository: makeEntitiesRepository({
			createOrUpdateGlobalEntity: (input) => {
				if (input.entitySchemaId === "schema-1") {
					globalEntityWritten = true;
					return Effect.succeed(baseEntity);
				}
				relatedEntityWritten = true;
				return Effect.succeed(relatedEntity);
			},
			findEntitySchemaScriptBySlug: () => Effect.succeed(relatedEntitySchemaScript),
			upsertEntityRelationship: () => {
				relationshipWritten = true;
				return Effect.void;
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const result = yield* runEntityImportWorkflow(payload, payload.executionId, () =>
				Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: {
						name: "Test Book",
						properties: { title: "Test Book" },
						relatedEntities: [
							{
								name: "Author",
								scriptSlug: "person.test",
								externalId: "person-ext-1",
								relationshipProperties: { roles: ["Author"] },
							},
						],
					},
				}),
			);

			expect(result.id).toBe("entity-1");
			expect(result.name).toBe("Test Book");
			expect(result.populatedAt).toBe(now);
			expect(globalEntityWritten).toBe(true);
			expect(relatedEntityWritten).toBe(true);
			expect(relationshipWritten).toBe(true);
			expect(libraryMembershipUserId).toBe("user-1");
			expect(libraryMembershipEntityId).toBe("entity-1");
		}),
	);
});

it.effect("short-circuits sandbox when global entity is already populated", () => {
	let sandboxCalled = false;
	let libraryMembershipCalled = false;

	const populatedEntity = { ...baseEntity, populatedAt: now };
	const payload = { ...importPayload, executionId: "exec-short-circuit" };
	const options = {
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: () => Effect.succeed(populatedEntity),
		}),
		collectionsService: makeCollectionsService(() => {
			libraryMembershipCalled = true;
			return Effect.void;
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const result = yield* runEntityImportWorkflow(payload, payload.executionId, () => {
				sandboxCalled = true;
				return Effect.succeed({
					logs: [],
					value: {},
					error: null,
					status: "completed" as const,
				});
			});

			expect(result.id).toBe("entity-1");
			expect(sandboxCalled).toBe(false);
			expect(libraryMembershipCalled).toBe(true);
		}),
	);
});

it.effect("fails workflow when sandbox returns an error", () => {
	const payload = { ...importPayload, executionId: "exec-sandbox-failure" };

	return withTestLayer(
		{},
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runEntityImportWorkflow(payload, payload.executionId, () =>
					Effect.succeed({
						logs: [],
						value: null,
						status: "completed" as const,
						error: "Sandbox script execution failed",
					}),
				),
			);

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const cause = exit.cause;
				expect(cause._tag).toBe("Fail");
				if (cause._tag === "Fail") {
					expect(cause.error.message).toBe("Sandbox script execution failed");
				}
			}
		}),
	);
});

it.effect("workflow body executes the sandbox step as part of orchestration", () => {
	let sandboxStepExecuted = false;

	const payload = { ...importPayload, executionId: "exec-orchestration" };
	const options = {
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaById: () => Effect.succeed(baseEntitySchema),
			createOrUpdateGlobalEntity: () => Effect.succeed(baseEntity),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runEntityImportWorkflow(payload, payload.executionId, () => {
				sandboxStepExecuted = true;
				return Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: { name: "Test", properties: { title: "Test" }, relatedEntities: [] },
				});
			});

			expect(sandboxStepExecuted).toBe(true);
		}),
	);
});

it.effect("fails workflow when related relationship properties are invalid", () => {
	let relationshipWritten = false;
	const payload = { ...importPayload, executionId: "exec-related-validation" };
	const options = {
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () =>
				Effect.succeed({
					isBuiltin: true,
					id: "rel-schema-1",
					slug: "authored-by",
					name: "Authored By",
					sourceEntitySchemaId: "schema-1",
					targetEntitySchemaId: "schema-person",
					propertiesSchema: {
						fields: {
							rating: {
								type: "number",
								label: "Rating",
								description: "Rating",
								validation: { required: true },
							},
						},
					},
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaScriptBySlug: () =>
				Effect.succeed({ entitySchemaId: "schema-person", sandboxScriptId: "person-script" }),
			upsertEntityRelationship: () =>
				Effect.sync(() => {
					relationshipWritten = true;
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runEntityImportWorkflow(payload, payload.executionId, () =>
					Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: {
							name: "Test Book",
							properties: { title: "Test Book" },
							relatedEntities: [
								{
									name: "Author",
									scriptSlug: "person.test",
									externalId: "person-ext-1",
									relationshipProperties: {},
								},
							],
						},
					}),
				),
			);

			expect(relationshipWritten).toBe(false);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const cause = exit.cause;
				expect(cause._tag).toBe("Fail");
				if (cause._tag === "Fail") {
					expect(cause.error.message).toBe("rating: is missing");
				}
			}
		}),
	);
});
