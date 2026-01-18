import { assert, expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { Effect, Layer } from "effect";

import { SandboxRunError } from "#lib/errors";
import {
	EntityId,
	EntitySchemaId,
	RelationshipSchemaId,
	RemoteImageUrl,
	SandboxScriptId,
	UserId,
} from "#lib/schema/brands";
import { dbRunnerLayer, makeMock, makeWorkflowActivityEngine } from "#lib/test-support/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { ListedEntity } from "#modules/entities/schemas";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";

import { processChildEntityTree } from "./population";
import { EntityImportPayload, runEntityImportWorkflow } from "./workflows";

const TestEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "TestEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const now = "2026-06-14T00:00:00.000Z";

const baseEntity = {
	image: null,
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	name: "Test Book",
	externalId: "ext-1",
	id: EntityId.make("entity-1"),
	properties: { title: "Test Book" },
	entitySchemaId: EntitySchemaId.make("schema-1"),
	sandboxScriptId: SandboxScriptId.make("script-1"),
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

const assertRecord: (value: unknown) => asserts value is Record<string, unknown> = (value) => {
	assert(typeof value === "object" && value !== null && !Array.isArray(value));
};

const makeEntitiesRepository = (overrides: Partial<EntitiesRepository> = {}) =>
	makeMock<EntitiesRepository>(
		{
			_tag: "EntitiesRepository" as const,
			saveEntity: () => Effect.die("unused"),
			getByIdForUser: () => Effect.die("unused"),
			getEntityScopeForUser: () => Effect.die("unused"),
			listMatchCandidatesBySchema: () => Effect.die("unused"),
			getEntitySchemaScopeForUser: () => Effect.die("unused"),
			findEntitySchemaScriptBySlug: () => Effect.succeed(null),
			findGlobalEntityByExternalId: () => Effect.succeed(null),
			findEntityByExternalIdForUser: () => Effect.die("unused"),
			findEntitySchemaById: () => Effect.succeed(baseEntitySchema),
		},
		overrides,
	);

const makeEntitiesService = (overrides: Partial<EntitiesService> = {}) =>
	makeMock<EntitiesService>(
		{
			_tag: "EntitiesService" as const,
			create: () => Effect.die("unused"),
			getById: () => Effect.die("unused"),
			save: () => Effect.succeed(baseEntity),
		},
		overrides,
	);

const makeRelationshipsRepository = (overrides: Partial<RelationshipsRepository> = {}) =>
	makeMock<RelationshipsRepository>(
		{ _tag: "RelationshipsRepository" as const, upsertEntityRelationship: () => Effect.void },
		overrides,
	);

const makeEntitySchemasRepository = (overrides: Partial<EntitySchemasRepository> = {}) =>
	makeMock<EntitySchemasRepository>(
		{
			_tag: "EntitySchemasRepository" as const,
			listByUser: () => Effect.die("unused"),
			findBySlug: () => Effect.die("unused"),
			getBuiltinBySlug: () => Effect.succeed(null),
			createEntitySchema: () => Effect.die("unused"),
			listVisibleBySlugs: () => Effect.die("unused"),
		},
		overrides,
	);

const makeRelationshipSchemasRepository = (
	overrides: Partial<RelationshipSchemasRepository> = {},
) =>
	makeMock<RelationshipSchemasRepository>(
		{
			findById: () => Effect.die("unused"),
			listByUser: () => Effect.die("unused"),
			_tag: "RelationshipSchemasRepository" as const,
			findBySlugForUser: () => Effect.die("unused"),
			findBuiltinBySlug: () => Effect.die("unused"),
			findGlobalBySchemaIds: () => Effect.succeed(null),
			getEntitySchemaScopeById: () => Effect.die("unused"),
			createRelationshipSchema: () => Effect.die("unused"),
		},
		overrides,
	);

type TestLayerOptions = {
	entitiesService?: EntitiesService;
	entitiesRepository?: EntitiesRepository;
	entitySchemasRepository?: EntitySchemasRepository;
	relationshipsRepository?: RelationshipsRepository;
	relationshipSchemasRepository?: RelationshipSchemasRepository;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
		Layer.succeed(EntitiesService, options.entitiesService ?? makeEntitiesService()),
		Layer.succeed(EntitiesRepository, options.entitiesRepository ?? makeEntitiesRepository()),
		Layer.succeed(
			EntitySchemasRepository,
			options.entitySchemasRepository ?? makeEntitySchemasRepository(),
		),
		Layer.succeed(
			RelationshipsRepository,
			options.relationshipsRepository ?? makeRelationshipsRepository(),
		),
		Layer.succeed(
			RelationshipSchemasRepository,
			options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
		),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(TestEntityImportWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

const importPayload = {
	externalId: "ext-1",
	executionId: "exec-1",
	userId: UserId.make("user-1"),
	scriptId: SandboxScriptId.make("script-1"),
	entitySchemaId: EntitySchemaId.make("schema-1"),
};

it.effect("populates entity and writes related entities", () => {
	let relationshipWritten = false;
	let globalEntityWritten = false;
	let relatedEntityImage: unknown;
	let relatedEntityWritten = false;
	const primaryImages: Array<ListedEntity["image"]> = [];

	const payload = { ...importPayload, executionId: "exec-full" };
	const expectedImage = {
		type: "remote" as const,
		url: RemoteImageUrl.make("https://example.com/image.jpg"),
	};
	const relatedEntitySchemaScript = {
		entitySchemaId: EntitySchemaId.make("schema-person"),
		sandboxScriptId: SandboxScriptId.make("person-script"),
	};
	const relationshipSchema = {
		isBuiltin: true,
		slug: "authored-by",
		name: "Authored By",
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaId.make("rel-schema-1"),
		sourceEntitySchemaId: EntitySchemaId.make("schema-1"),
		targetEntitySchemaId: EntitySchemaId.make("schema-person"),
	};
	const relatedEntity = {
		image: null,
		name: "Author",
		createdAt: now,
		updatedAt: now,
		properties: {},
		populatedAt: null,
		externalId: "person-ext-1",
		id: EntityId.make("person-1"),
		entitySchemaId: EntitySchemaId.make("schema-person"),
		sandboxScriptId: SandboxScriptId.make("person-script-id"),
	} satisfies ListedEntity;
	const options = {
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () => Effect.succeed(relationshipSchema),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaScriptBySlug: () => Effect.succeed(relatedEntitySchemaScript),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			upsertEntityRelationship: () => {
				relationshipWritten = true;
				return Effect.void;
			},
		}),
		entitiesService: makeEntitiesService({
			save: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity save");
				}
				if (input.entitySchemaId === "schema-1") {
					primaryImages.push(input.image);
					globalEntityWritten = true;
					return Effect.succeed({
						...baseEntity,
						image: input.image,
						populatedAt: input.populatedAt === null ? null : now,
					});
				}
				relatedEntityImage = input.image;
				relatedEntityWritten = true;
				return Effect.succeed(relatedEntity);
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
						image: expectedImage,
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
			expect(result.image).toEqual(expectedImage);
			expect(result.populatedAt).toBe(now);
			expect(primaryImages).toEqual([null, expectedImage]);
			expect(relatedEntityImage).toBeNull();
			expect(globalEntityWritten).toBe(true);
			expect(relatedEntityWritten).toBe(true);
			expect(relationshipWritten).toBe(true);
		}),
	);
});

type StoredChildEntity = Omit<ListedEntity, "properties" | "sandboxScriptId"> & {
	sandboxScriptId: SandboxScriptId;
	properties: Record<string, unknown>;
};

it.effect("writes child entity trees idempotently", () => {
	const storedRelationships = new Set<string>();
	const storedEntities = new Map<string, StoredChildEntity>();
	const entityWrites: Array<{
		name: string;
		externalId: string;
		properties: unknown;
		image: ListedEntity["image"];
		entitySchemaId: EntitySchemaId;
		sandboxScriptId: SandboxScriptId;
	}> = [];
	const relationshipSchemas = new Map([
		[
			"schema-1->schema-season",
			{
				isBuiltin: true,
				name: "Show to Show Season",
				slug: "show-to-show-season",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaId.make("rel-show-season"),
				sourceEntitySchemaId: EntitySchemaId.make("schema-1"),
				targetEntitySchemaId: EntitySchemaId.make("schema-season"),
			},
		],
		[
			"schema-season->schema-episode",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Show Season to Show Episode",
				slug: "show-season-to-show-episode",
				id: RelationshipSchemaId.make("rel-season-episode"),
				sourceEntitySchemaId: EntitySchemaId.make("schema-season"),
				targetEntitySchemaId: EntitySchemaId.make("schema-episode"),
			},
		],
	]);
	const options = {
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug: string) =>
				Effect.succeed(
					slug === "show-season"
						? { id: EntitySchemaId.make("schema-season") }
						: slug === "show-episode"
							? { id: EntitySchemaId.make("schema-episode") }
							: null,
				),
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: (input) =>
				Effect.succeed(
					relationshipSchemas.get(`${input.sourceEntitySchemaId}->${input.targetEntitySchemaId}`) ??
						null,
				),
		}),
		entitiesService: makeEntitiesService({
			save: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity save");
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				entityWrites.push(input);
				const key = `${input.entitySchemaId}:${input.externalId}:${input.sandboxScriptId}`;
				const existing = storedEntities.get(key);
				if (existing) {
					return Effect.succeed(existing);
				}

				const entity = {
					...baseEntity,
					properties,
					name: input.name,
					image: input.image,
					externalId: input.externalId,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: EntityId.make(`${input.entitySchemaId}-${input.externalId}`),
				} satisfies StoredChildEntity;
				storedEntities.set(key, entity);
				return Effect.succeed(entity);
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			upsertEntityRelationship: (input) =>
				Effect.sync(() => {
					storedRelationships.add(
						`${input.relationshipSchemaId}:${input.sourceEntityId}->${input.targetEntityId}`,
					);
				}),
		}),
	} satisfies TestLayerOptions;

	const runProcessor = (executionId: string) =>
		withTestLayer(
			options,
			executionId,
			processChildEntityTree({
				activityPrefix: "",
				parentEntityId: baseEntity.id,
				sandboxScriptId: SandboxScriptId.make("script-1"),
				parentEntitySchemaId: EntitySchemaId.make("schema-1"),
				childEntities: [
					{
						name: "Season 1",
						externalId: "season-1",
						entitySchemaSlug: "show-season",
						image: { type: "remote", url: RemoteImageUrl.make("https://example.com/season.jpg") },
						properties: { seasonNumber: 1, description: "Season", releaseDate: "2026-01-01" },
						childEntities: [
							{
								name: "Episode 1",
								externalId: "episode-1",
								entitySchemaSlug: "show-episode",
								properties: {
									runtime: 45,
									seasonNumber: 1,
									episodeNumber: 1,
									description: "Episode",
									publishDate: "2026-01-02",
								},
							},
						],
					},
				],
			}),
		);

	return Effect.gen(function* () {
		yield* runProcessor("exec-child-tree-1");
		yield* runProcessor("exec-child-tree-2");

		expect(storedEntities.size).toBe(2);
		expect(storedRelationships.size).toBe(2);
		expect(entityWrites).toHaveLength(4);
		expect(entityWrites[0]?.sandboxScriptId).toBe("script-1");
		expect(entityWrites[0]?.image).toEqual({
			type: "remote",
			url: "https://example.com/season.jpg",
		});
		expect(storedEntities.get("schema-season:season-1:script-1")?.properties).toEqual({
			description: "Season",
			releaseDate: "2026-01-01",
			seasonNumber: 1,
		});
		expect(storedEntities.get("schema-episode:episode-1:script-1")?.properties).toEqual({
			runtime: 45,
			seasonNumber: 1,
			episodeNumber: 1,
			description: "Episode",
			publishDate: "2026-01-02",
		});
	});
});

it.effect("uses explicit details image for the primary entity", () => {
	const primaryImages: Array<ListedEntity["image"]> = [];

	const payload = { ...importPayload, executionId: "exec-explicit-image" };
	const explicitImage = { type: "s3" as const, key: "entities/test-book.jpg" };
	const options = {
		entitiesService: makeEntitiesService({
			save: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity save");
				}
				primaryImages.push(input.image);
				return Effect.succeed({
					...baseEntity,
					image: input.image,
					populatedAt: input.populatedAt === null ? null : now,
				});
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
					value: { name: "Test Book", image: explicitImage, properties: { title: "Test Book" } },
				}),
			);

			expect(result.image).toEqual(explicitImage);
			expect(primaryImages).toEqual([null, explicitImage]);
		}),
	);
});

it.effect("short-circuits sandbox when global entity is already populated", () => {
	let sandboxCalled = false;

	const populatedEntity = { ...baseEntity, populatedAt: now };
	const payload = { ...importPayload, executionId: "exec-short-circuit" };
	const options = {
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: () => Effect.succeed(populatedEntity),
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
		entitiesService: makeEntitiesService({ save: () => Effect.succeed(baseEntity) }),
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
					id: RelationshipSchemaId.make("rel-schema-1"),
					slug: "authored-by",
					name: "Authored By",
					sourceEntitySchemaId: EntitySchemaId.make("schema-1"),
					targetEntitySchemaId: EntitySchemaId.make("schema-person"),
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
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-person"),
					sandboxScriptId: SandboxScriptId.make("person-script"),
				}),
		}),
		entitiesService: makeEntitiesService({
			save: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity save");
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				const nextEntity = {
					...baseEntity,
					properties,
					name: input.name,
					externalId: input.externalId,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: EntityId.make(input.entitySchemaId === "schema-1" ? "entity-1" : "person-1"),
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
					id: RelationshipSchemaId.make("rel-schema-1"),
					slug: "authored-by",
					name: "Authored By",
					propertiesSchema: { fields: {} },
					sourceEntitySchemaId: EntitySchemaId.make("schema-1"),
					targetEntitySchemaId: EntitySchemaId.make("schema-person"),
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaScriptBySlug: () =>
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-person"),
					sandboxScriptId: SandboxScriptId.make("person-script"),
				}),
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
					id: RelationshipSchemaId.make("rel-schema-1"),
					slug: "authored-by",
					name: "Authored By",
					sourceEntitySchemaId: EntitySchemaId.make("schema-1"),
					targetEntitySchemaId: EntitySchemaId.make("schema-person"),
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
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-person"),
					sandboxScriptId: SandboxScriptId.make("person-script"),
				}),
		}),
		entitiesService: makeEntitiesService({
			save: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity save");
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				const nextEntity = {
					...baseEntity,
					properties,
					name: input.name,
					externalId: input.externalId,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: EntityId.make(input.entitySchemaId === "schema-1" ? "entity-1" : "person-1"),
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
