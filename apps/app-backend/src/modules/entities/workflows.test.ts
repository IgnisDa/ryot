import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import type { Context } from "effect";
import { Effect, Layer } from "effect";

import { dbRunnerLayer, makeMock, makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { EntityImportHook } from "./entity-import-hook";
import { EntitiesRepository } from "./repository";
import type { ListedEntity } from "./schemas";
import { EntityImportWorkflow, runEntityImportWorkflow } from "./workflows";

const now = "2026-06-14T00:00:00.000Z";

const baseEntity = {
	image: null,
	createdAt: now,
	updatedAt: now,
	id: "entity-1",
	populatedAt: now,
	name: "Test Book",
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

type StoredEntity = Omit<typeof baseEntity, "populatedAt" | "properties"> & {
	populatedAt: string | null;
	properties: Record<string, unknown>;
};

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			createEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			getEntityScopeById: () => Effect.die("unused"),
			getEntityScopeForUser: () => Effect.die("unused"),
			listMatchCandidatesBySchema: () => Effect.die("unused"),
			getEntitySchemaScopeForUser: () => Effect.die("unused"),
			findEntitySchemaScriptBySlug: () => Effect.succeed(null),
			findGlobalEntityByExternalId: () => Effect.succeed(null),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
			findEntitySchemaById: () => Effect.succeed(baseEntitySchema),
			createOrUpdateGlobalEntity: () => Effect.succeed(baseEntity),
		},
		overrides,
	);

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{ _tag: "RelationshipsRepository" as const, upsertEntityRelationship: () => Effect.void },
		overrides,
	);

const makeRelationshipSchemasRepository = (
	overrides: Partial<RelationshipSchemasRepository> = {},
) =>
	makeMock<RelationshipSchemasRepository>(
		{
			findById: () => Effect.die("unused"),
			_tag: "RelationshipSchemasRepository" as const,
			findBuiltinBySlug: () => Effect.die("unused"),
			findGlobalBySchemaIds: () => Effect.succeed(null),
		},
		overrides,
	);

const makeEntityImportHook = (
	onEntityImported: (userId: string, entityId: string) => Effect.Effect<void> = () => Effect.void,
): Context.Tag.Service<typeof EntityImportHook> => ({ onEntityImported });

type TestLayerOptions = {
	entitiesRepository?: EntitiesRepository;
	relationshipsRepository?: RelationshipsRepository;
	relationshipSchemasRepository?: RelationshipSchemasRepository;
	entityImportHook?: Context.Tag.Service<typeof EntityImportHook>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
		Layer.succeed(
			RelationshipsRepository,
			options.relationshipsRepository ?? makeRelationshipsRepository(),
		),
		Layer.succeed(
			RelationshipSchemasRepository,
			options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
		),
		Layer.succeed(EntityImportHook, options.entityImportHook ?? makeEntityImportHook()),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(EntityImportWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

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

	const payload = { ...importPayload, executionId: "exec-full" };
	const relatedEntitySchemaScript = {
		entitySchemaId: "schema-person",
		sandboxScriptId: "person-script",
	};
	const relationshipSchema = {
		isBuiltin: true,
		id: "rel-schema-1",
		slug: "authored-by",
		name: "Authored By",
		propertiesSchema: { fields: {} },
		sourceEntitySchemaId: "schema-1",
		targetEntitySchemaId: "schema-person",
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
	const options = {
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () => Effect.succeed(relationshipSchema),
		}),
		entityImportHook: makeEntityImportHook((userId, entityId) => {
			libraryMembershipUserId = userId;
			libraryMembershipEntityId = entityId;
			return Effect.void;
		}),
		relationshipsRepository: makeRelationshipsRepository({
			upsertEntityRelationship: () => {
				relationshipWritten = true;
				return Effect.void;
			},
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
		entityImportHook: makeEntityImportHook(() => {
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
	let storedEntity: StoredEntity | null = null;
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
			findGlobalEntityByExternalId: () => Effect.succeed(storedEntity),
			findEntitySchemaScriptBySlug: () =>
				Effect.succeed({ entitySchemaId: "schema-person", sandboxScriptId: "person-script" }),
			createOrUpdateGlobalEntity: (input) => {
				const nextEntity = {
					...baseEntity,
					name: input.name,
					externalId: input.externalId,
					properties: input.properties,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: input.entitySchemaId === "schema-1" ? "entity-1" : "person-1",
				};
				if (input.entitySchemaId === "schema-1") {
					storedEntity = nextEntity;
				}

				return Effect.succeed(nextEntity);
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
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
			expect(storedEntity?.populatedAt).toBeNull();
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

it.effect("fails workflow when related relationship properties are not objects", () => {
	let relationshipWritten = false;
	const payload = { ...importPayload, executionId: "exec-related-type-validation" };
	const options = {
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () =>
				Effect.succeed({
					isBuiltin: true,
					id: "rel-schema-1",
					slug: "authored-by",
					name: "Authored By",
					propertiesSchema: { fields: {} },
					sourceEntitySchemaId: "schema-1",
					targetEntitySchemaId: "schema-person",
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaScriptBySlug: () =>
				Effect.succeed({ entitySchemaId: "schema-person", sandboxScriptId: "person-script" }),
		}),
		relationshipsRepository: makeRelationshipsRepository({
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
									relationshipProperties: [],
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
					expect(cause.error.message.length).toBeGreaterThan(0);
				}
			}
		}),
	);
});

it.effect("retries related writes after a failed related validation", () => {
	let relationshipWriteCount = 0;
	let sandboxCalls = 0;
	let storedEntity: StoredEntity | null = null;

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
			findGlobalEntityByExternalId: () => Effect.succeed(storedEntity),
			findEntitySchemaScriptBySlug: () =>
				Effect.succeed({ entitySchemaId: "schema-person", sandboxScriptId: "person-script" }),
			createOrUpdateGlobalEntity: (input) => {
				const nextEntity = {
					...baseEntity,
					name: input.name,
					externalId: input.externalId,
					properties: input.properties,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: input.entitySchemaId === "schema-1" ? "entity-1" : "person-1",
				};
				if (input.entitySchemaId === "schema-1") {
					storedEntity = nextEntity;
				}

				return Effect.succeed(nextEntity);
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			upsertEntityRelationship: () =>
				Effect.sync(() => {
					relationshipWriteCount += 1;
				}),
		}),
	} satisfies TestLayerOptions;

	const runAttempt = (executionId: string, relationshipProperties: unknown) =>
		withTestLayer(
			options,
			executionId,
			runEntityImportWorkflow({ ...importPayload, executionId }, executionId, () => {
				sandboxCalls += 1;
				return Effect.succeed({
					logs: [],
					error: null,
					status: "completed" as const,
					value: {
						name: "Test Book",
						properties: { title: "Test Book" },
						relatedEntities: [
							{
								name: "Author",
								relationshipProperties,
								scriptSlug: "person.test",
								externalId: "person-ext-1",
							},
						],
					},
				});
			}),
		);

	return Effect.gen(function* () {
		const firstExit = yield* Effect.exit(runAttempt("exec-related-retry-1", {}));

		expect(firstExit._tag).toBe("Failure");
		expect(storedEntity?.populatedAt).toBeNull();

		const secondResult = yield* runAttempt("exec-related-retry-2", { rating: 5 });

		expect(sandboxCalls).toBe(2);
		expect(relationshipWriteCount).toBe(1);
		expect(secondResult.id).toBe("entity-1");
		expect(secondResult.populatedAt).not.toBeNull();
	});
});
