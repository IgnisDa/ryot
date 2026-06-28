import { assert, expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaId,
	RelationshipId,
	RelationshipSchemaId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { CurrentDb, TransactionRunner } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
	transactionLayer,
} from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { EntityImportPayload } from "./entity-import-workflow";
import {
	EntityImportWorkflowOperations,
	type EntityImportWorkflowOperationsValue,
} from "./operations-workflow";
import { processChildEntityTree } from "./population";
import { runProviderEntityPopulationWorkflow } from "./provider-entity-population-workflow";

const TestEntityImportWorkflow = Workflow.make({
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	name: "TestEntityImportWorkflow",
	idempotencyKey: ({ executionId }) => executionId,
});

const now = "2026-06-14T00:00:00.000Z";

const baseEntity = {
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

const savedRelationship = {
	properties: {},
	createdAt: now,
	wasInserted: true,
	id: RelationshipId.make("relationship-1"),
	sourceEntityId: EntityId.make("source-entity-id"),
	targetEntityId: EntityId.make("target-entity-id"),
	relationshipSchemaId: RelationshipSchemaId.make("relationship-schema-id"),
};

const mediaSuggestionSchema = {
	isBuiltin: true,
	name: "Media Suggestion",
	slug: "media-suggestion",
	sourceEntitySchemaId: null,
	targetEntitySchemaId: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaId.make("media-suggestion-schema-id"),
};

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

const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockEntitiesService = Layer.mock(EntitiesService);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		findEntitySchemaSandboxScriptBySlug: () => Effect.succeed(null),
		findGlobalEntityByExternalId: () => Effect.succeed(null),
		findEntitySchemaById: () => Effect.succeed(baseEntitySchema),
		...overrides,
		_tag: "EntitiesRepository",
	});

const makeEntitiesService = (overrides: MockOverrides<typeof mockEntitiesService> = {}) =>
	mockEntitiesService({
		create: () => Effect.succeed(baseEntity),
		update: () => Effect.succeed(baseEntity),
		upsert: () => Effect.succeed(baseEntity),
		...overrides,
		_tag: "EntitiesService",
	});

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		createRelationship: () => Effect.succeed(savedRelationship),
		updateRelationship: () => Effect.succeed(savedRelationship),
		deleteRelationship: () => Effect.succeed(null),
		listGlobalRelationships: () => Effect.succeed([]),
		...overrides,
		_tag: "RelationshipsRepository",
	});

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) =>
	mockEntitySchemasRepository({
		getBuiltinBySlug: () => Effect.succeed(null),
		...overrides,
		_tag: "EntitySchemasRepository",
	});

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		findBuiltinBySlug: (slug: string) =>
			Effect.succeed(slug === "media-suggestion" ? mediaSuggestionSchema : null),
		findGlobalBySchemaIds: () => Effect.succeed(null),
		...overrides,
		_tag: "RelationshipSchemasRepository",
	});

type TestLayerOptions = {
	entitiesService?: Layer.Layer<EntitiesService>;
	transactionRunner?: Layer.Layer<TransactionRunner>;
	entitiesRepository?: Layer.Layer<EntitiesRepository>;
	entitySchemasRepository?: Layer.Layer<EntitySchemasRepository>;
	relationshipsRepository?: Layer.Layer<RelationshipsRepository>;
	processSandbox?: EntityImportWorkflowOperationsValue["processSandbox"];
	relationshipSchemasRepository?: Layer.Layer<RelationshipSchemasRepository>;
};

const makeTestLayer = (options: TestLayerOptions) => {
	const relationshipsRepository = options.relationshipsRepository ?? makeRelationshipsRepository();

	const relationshipsServiceLayer = RelationshipsService.Default.pipe(
		Layer.provide(Layer.mergeAll(dbRunnerLayer, relationshipsRepository)),
	);

	return Layer.mergeAll(
		dbRunnerLayer,
		options.transactionRunner ?? transactionLayer,
		relationshipsServiceLayer,
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(0) })),
		Layer.mock(EntityImportWorkflowOperations, {
			processSandbox: options.processSandbox ?? (() => Effect.die("unused")),
		}),
		options.entitiesService ?? makeEntitiesService(),
		options.entitiesRepository ?? makeEntitiesRepository(),
		options.entitySchemasRepository ?? makeEntitySchemasRepository(),
		relationshipsRepository,
		options.relationshipSchemasRepository ?? makeRelationshipSchemasRepository(),
	);
};

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
	let staleRelationshipDeleted = false;
	let globalEntityWritten = false;
	let relatedEntityWritten = false;

	const payload = { ...importPayload, executionId: "exec-full" };
	const relatedEntitySchemaSandboxScript = {
		entitySchemaId: EntitySchemaId.make("schema-person"),
		sandboxScriptId: SandboxScriptId.make("person-script"),
	};
	const relationshipSchema = {
		isBuiltin: true,
		slug: "authored-by",
		name: "Authored By",
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaId.make("rel-schema-1"),
		targetEntitySchemaId: EntitySchemaId.make("schema-1"),
		sourceEntitySchemaId: EntitySchemaId.make("schema-person"),
	};
	const relatedEntity = {
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
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "authored-by",
							entities: [
								{
									name: "Author",
									scriptSlug: "person.test",
									externalId: "person-ext-1",
									relationshipProperties: { roles: ["Author"] },
								},
							],
						},
					],
				},
			}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findBuiltinBySlug: () => Effect.succeed(relationshipSchema),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: () => Effect.succeed(relatedEntitySchemaSandboxScript),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () =>
				Effect.succeed([
					{
						...savedRelationship,
						sourceEntityId: EntityId.make("person-stale"),
						targetEntityId: baseEntity.id,
						relationshipSchemaId: relationshipSchema.id,
					},
				]),
			createRelationship: () =>
				Effect.sync(() => {
					relationshipWritten = true;
					return savedRelationship;
				}),
			deleteRelationship: () =>
				Effect.sync(() => {
					staleRelationshipDeleted = true;
					return savedRelationship;
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				if (input.entitySchemaId !== "schema-1") {
					return Effect.die("unexpected upsert for non-primary entity");
				}
				globalEntityWritten = true;
				return Effect.succeed({
					...baseEntity,
					populatedAt: input.populatedAt === null ? null : now,
				});
			},
			create: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity create");
				}
				relatedEntityWritten = true;
				return Effect.succeed(relatedEntity);
			},
			update: () => {
				globalEntityWritten = true;
				return Effect.succeed(baseEntity);
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const result = yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);
			expect(result.id).toBe("entity-1");
			expect(result.name).toBe("Test Book");
			expect(result.populatedAt).toBe(now);
			expect(globalEntityWritten).toBe(true);
			expect(relatedEntityWritten).toBe(true);
			expect(relationshipWritten).toBe(true);
			expect(staleRelationshipDeleted).toBe(true);
		}),
	);
});

it.effect("preserves stale relationships during additive related-entity sync", () => {
	let created = false;
	let deleted = false;
	const payload = { ...importPayload, executionId: "exec-additive-related" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "additive" as const,
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ externalId: "movie-1", name: "Suggested Movie", scriptSlug: "movie.test" },
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: () =>
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-movie"),
					sandboxScriptId: SandboxScriptId.make("movie-script"),
				}),
		}),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.succeed({
					...baseEntity,
					id: EntityId.make("suggested-movie"),
					entitySchemaId: EntitySchemaId.make("schema-movie"),
					sandboxScriptId: SandboxScriptId.make("movie-script"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () =>
				Effect.succeed([
					{
						...savedRelationship,
						sourceEntityId: baseEntity.id,
						targetEntityId: EntityId.make("stale-target"),
						relationshipSchemaId: mediaSuggestionSchema.id,
					},
				]),
			createRelationship: () =>
				Effect.sync(() => {
					created = true;
					return savedRelationship;
				}),
			deleteRelationship: () =>
				Effect.sync(() => {
					deleted = true;
					return savedRelationship;
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);
			expect(created).toBe(true);
			expect(deleted).toBe(false);
		}),
	);
});

it.effect("walks the child entity tree and upserts each node", () => {
	const storedRelationships = new Set<string>();
	const entityWrites: Array<{
		name: string;
		externalId: string;
		properties: unknown;
		updateExisting: boolean;
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
			getBuiltinBySlug: (slug: string) => {
				let result: { id: EntitySchemaId } | null = null;
				switch (slug) {
					case "show-season": {
						result = { id: EntitySchemaId.make("schema-season") };
						break;
					}
					case "show-episode": {
						result = { id: EntitySchemaId.make("schema-episode") };
						break;
					}
				}
				return Effect.succeed(result);
			},
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: (input) =>
				Effect.succeed(
					relationshipSchemas.get(`${input.sourceEntitySchemaId}->${input.targetEntitySchemaId}`) ??
						null,
				),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				const properties: unknown = input.properties;
				assertRecord(properties);
				entityWrites.push({
					properties,
					name: input.name,
					externalId: input.externalId,
					updateExisting: input.updateExisting,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
				});
				return Effect.succeed({
					...baseEntity,
					properties,
					name: input.name,
					externalId: input.externalId,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: EntityId.make(`${input.entitySchemaId}-${input.externalId}`),
				});
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: (input) =>
				Effect.sync(() => {
					storedRelationships.add(
						`${input.relationshipSchemaId}:${input.sourceEntityId}->${input.targetEntityId}`,
					);
					return savedRelationship;
				}),
		}),
	} satisfies TestLayerOptions;

	const runProcessor = (executionId: string) =>
		withTestLayer(
			options,
			executionId,
			processChildEntityTree({
				parentEntityId: baseEntity.id,
				sandboxScriptId: SandboxScriptId.make("script-1"),
				parentEntitySchemaId: EntitySchemaId.make("schema-1"),
				childEntities: [
					{
						name: "Season 1",
						externalId: "season-1",
						entitySchemaSlug: "show-season",
						properties: {
							seasonNumber: 1,
							description: "Season",
							releaseDate: "2026-01-01",
							images: [{ type: "remote", url: "https://example.com/season.jpg" }],
						},
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

		expect(storedRelationships.size).toBe(2);
		expect(entityWrites).toHaveLength(2);
		expect(entityWrites.every((write) => !write.updateExisting)).toBe(true);

		const season = entityWrites.find((write) => write.externalId === "season-1");
		const episode = entityWrites.find((write) => write.externalId === "episode-1");

		expect(season?.sandboxScriptId).toBe("script-1");
		expect(season?.entitySchemaId).toBe("schema-season");
		expect(season?.properties).toEqual({
			description: "Season",
			releaseDate: "2026-01-01",
			seasonNumber: 1,
			images: [{ type: "remote", url: "https://example.com/season.jpg" }],
		});
		expect(episode?.entitySchemaId).toBe("schema-episode");
		expect(episode?.properties).toEqual({
			runtime: 45,
			seasonNumber: 1,
			episodeNumber: 1,
			description: "Episode",
			publishDate: "2026-01-02",
		});
	});
});

it.effect("propagates images through properties for the primary entity", () => {
	const savedProperties: unknown[] = [];

	const payload = { ...importPayload, executionId: "exec-images-properties" };
	const images = [{ type: "s3" as const, key: "entities/test-book.jpg" }];
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { name: "Test Book", properties: { title: "Test Book", images } },
			}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				const properties: unknown = input.properties;
				assertRecord(properties);
				savedProperties.push(input.properties);
				return Effect.succeed({
					...baseEntity,
					properties,
					populatedAt: input.populatedAt === null ? null : now,
				});
			},
			update: (input) => {
				const properties: unknown = input.properties;
				assertRecord(properties);
				savedProperties.push(input.properties);
				return Effect.succeed({
					...baseEntity,
					properties,
					populatedAt: input.populatedAt === null ? null : now,
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);

			expect(savedProperties).toEqual([
				{ title: "Test Book", images },
				{ title: "Test Book", images },
			]);
		}),
	);
});

it.effect("creates placeholder suggestion entities and syncs source suggestions", () => {
	const relationshipWrites: unknown[] = [];
	const placeholderWrites: Array<{
		name: string;
		externalId: string;
		populatedAt: string | null;
		entitySchemaId: EntitySchemaId;
		sandboxScriptId: SandboxScriptId;
		properties: Record<string, unknown>;
	}> = [];
	const movieSchemaScript = {
		entitySchemaId: EntitySchemaId.make("schema-movie"),
		sandboxScriptId: SandboxScriptId.make("movie-script"),
	};
	const payload = { ...importPayload, executionId: "exec-suggestions" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					relatedEntityGroups: [
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ externalId: "movie-1", scriptSlug: "movie.tmdb", name: "Recommended Movie" },
								{
									externalId: "missing-1",
									name: "Missing Suggestion",
									scriptSlug: "missing.provider",
								},
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: (slug: string) =>
				Effect.succeed(slug === "movie.tmdb" ? movieSchemaScript : null),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) =>
				Effect.succeed({
					...baseEntity,
					populatedAt: input.populatedAt === null ? null : now,
				}),
			create: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity create");
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				placeholderWrites.push({
					properties,
					name: input.name,
					externalId: input.externalId,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				});
				return Effect.succeed({
					...baseEntity,
					properties,
					name: input.name,
					populatedAt: null,
					externalId: input.externalId,
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					id: EntityId.make(`suggestion-${input.externalId}`),
				});
			},
			update: (input) =>
				Effect.succeed({
					...baseEntity,
					populatedAt: input.populatedAt === null ? null : now,
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: (input) =>
				Effect.sync(() => {
					relationshipWrites.push(input);
					return {
						...savedRelationship,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaId: input.relationshipSchemaId,
					};
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const result = yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);

			expect(result.id).toBe("entity-1");
			expect(result.populatedAt).toBe(now);
			expect(placeholderWrites).toEqual([
				{
					name: "Recommended Movie",
					externalId: "movie-1",
					properties: {},
					populatedAt: null,
					entitySchemaId: EntitySchemaId.make("schema-movie"),
					sandboxScriptId: SandboxScriptId.make("movie-script"),
				},
			]);
			expect(relationshipWrites).toEqual([
				expect.objectContaining({
					scope: "global",
					sourceEntityId: EntityId.make("entity-1"),
					targetEntityId: EntityId.make("suggestion-movie-1"),
					relationshipSchemaId: mediaSuggestionSchema.id,
					properties: {},
				}),
			]);
		}),
	);
});

it.effect("replaces stale synced suggestions on a later import run", () => {
	let storedPrimaryEntity: StoredEntity | null = null;
	const currentTargets = new Set<string>();
	const syncCalls: Array<ReadonlyArray<EntityId>> = [];
	const movieSchemaScript = {
		entitySchemaId: EntitySchemaId.make("schema-movie"),
		sandboxScriptId: SandboxScriptId.make("movie-script"),
	};
	const makeStoredRelationship = (targetEntityId: EntityId) => ({
		properties: {},
		createdAt: now,
		wasInserted: true,
		id: RelationshipId.make("relationship-1"),
		sourceEntityId: baseEntity.id,
		targetEntityId,
		relationshipSchemaId: mediaSuggestionSchema.id,
	});

	const runAttempt = (
		executionId: string,
		suggestions: ReadonlyArray<{ name: string; externalId: string; scriptSlug: string }>,
	) =>
		withTestLayer(
			{
				processSandbox: () =>
					Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: {
							name: "Test Book",
							properties: { title: "Test Book" },
							relatedEntityGroups: [
								{
									entities: suggestions,
									direction: "outgoing",
									synchronization: "authoritative",
									relationshipSchemaSlug: "media-suggestion",
								},
							],
						},
					}),
				entitiesRepository: makeEntitiesRepository({
					findEntitySchemaSandboxScriptBySlug: (slug: string) =>
						Effect.succeed(slug === "movie.tmdb" ? movieSchemaScript : null),
					findGlobalEntityByExternalId: () => Effect.succeed(storedPrimaryEntity),
				}),
				entitiesService: makeEntitiesService({
					upsert: (input) => {
						if (input.entitySchemaId !== importPayload.entitySchemaId) {
							return Effect.die("unexpected upsert for non-primary entity");
						}
						storedPrimaryEntity = {
							...baseEntity,
							name: input.name,
							populatedAt: null,
							externalId: input.externalId,
							properties: { title: "Test Book" },
							entitySchemaId: input.entitySchemaId,
							sandboxScriptId: input.sandboxScriptId,
						};
						return Effect.succeed({
							...storedPrimaryEntity,
							populatedAt: input.populatedAt === null ? null : now,
						});
					},
					create: (input) => {
						if (input.scope !== "global") {
							return Effect.die("unexpected user entity create");
						}
						return Effect.succeed({
							...baseEntity,
							properties: {},
							name: input.name,
							populatedAt: null,
							externalId: input.externalId,
							entitySchemaId: input.entitySchemaId,
							sandboxScriptId: input.sandboxScriptId,
							id: EntityId.make(`suggestion-${input.externalId}`),
						});
					},
					update: (input) => {
						assert(storedPrimaryEntity);
						return Effect.succeed({
							...storedPrimaryEntity,
							populatedAt: input.populatedAt === null ? null : now,
						});
					},
				}),
				relationshipsRepository: makeRelationshipsRepository({
					listGlobalRelationships: () =>
						Effect.succeed(
							[...currentTargets].map((targetEntityId) =>
								makeStoredRelationship(EntityId.make(targetEntityId)),
							),
						),
					createRelationship: (input) =>
						Effect.sync(() => {
							syncCalls.push([input.targetEntityId]);
							currentTargets.add(input.targetEntityId);
							return {
								...savedRelationship,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaId: input.relationshipSchemaId,
							};
						}),
					deleteRelationship: (input) =>
						Effect.sync(() => {
							currentTargets.delete(input.targetEntityId);
							return {
								...savedRelationship,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaId: input.relationshipSchemaId,
							};
						}),
				}),
			},
			executionId,
			runProviderEntityPopulationWorkflow(
				{ ...importPayload, executionId, mode: "ensure" },
				executionId,
			),
		);

	return Effect.gen(function* () {
		yield* runAttempt("exec-suggestions-replace-1", [
			{
				externalId: "movie-1",
				scriptSlug: "movie.tmdb",
				name: "First Recommendation",
			},
		]);
		yield* runAttempt("exec-suggestions-replace-2", [
			{
				externalId: "movie-2",
				scriptSlug: "movie.tmdb",
				name: "Second Recommendation",
			},
		]);

		expect(syncCalls).toEqual([
			[EntityId.make("suggestion-movie-1")],
			[EntityId.make("suggestion-movie-2")],
		]);
		expect([...currentTargets]).toEqual(["suggestion-movie-2"]);
	});
});

it.effect("does not synchronize relationships when the provider declares no groups", () => {
	let relationshipWrites = 0;

	const payload = { ...importPayload, executionId: "exec-no-explicit-slug" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					relatedEntityGroups: [],
					properties: { title: "Test Book" },
				},
			}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () =>
				Effect.sync(() => {
					relationshipWrites += 1;
					return savedRelationship;
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);

			expect(relationshipWrites).toBe(0);
		}),
	);
});

it.effect("short-circuits sandbox when global entity is already populated", () => {
	let sandboxCalled = false;

	const populatedEntity = { ...baseEntity, populatedAt: now };
	const payload = { ...importPayload, executionId: "exec-short-circuit" };
	const options = {
		processSandbox: () => {
			sandboxCalled = true;
			return Effect.succeed({
				logs: [],
				value: {},
				error: null,
				status: "completed" as const,
			});
		},
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: () => Effect.succeed(populatedEntity),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const result = yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);

			expect(result.id).toBe("entity-1");
			expect(sandboxCalled).toBe(false);
		}),
	);
});

it.effect("fails workflow when sandbox returns an error", () => {
	const payload = { ...importPayload, executionId: "exec-sandbox-failure" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				value: null,
				status: "completed" as const,
				error: { phase: "execute" as const, message: "Sandbox script execution failed" },
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProviderEntityPopulationWorkflow({ ...payload, mode: "ensure" }, payload.executionId),
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
		processSandbox: () => {
			sandboxStepExecuted = true;
			return Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { name: "Test", properties: { title: "Test" } },
			});
		},
		entitiesService: makeEntitiesService({ upsert: () => Effect.succeed(baseEntity) }),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);

			expect(sandboxStepExecuted).toBe(true);
		}),
	);
});

it.effect("keeps the refresh baseline when related relationship properties are invalid", () => {
	let relationshipWritten = false;
	let primaryWritten = false;
	let storedEntity: StoredEntity | null = {
		...baseEntity,
		properties: { title: "Previous Book" },
	};
	const payload = { ...importPayload, executionId: "exec-related-validation" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "authored-by",
							entities: [
								{
									name: "Author",
									scriptSlug: "person.test",
									externalId: "person-ext-1",
									relationshipProperties: {},
								},
							],
						},
					],
				},
			}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findBuiltinBySlug: () =>
				Effect.succeed({
					isBuiltin: true,
					slug: "authored-by",
					name: "Authored By",
					id: RelationshipSchemaId.make("rel-schema-1"),
					targetEntitySchemaId: EntitySchemaId.make("schema-1"),
					sourceEntitySchemaId: EntitySchemaId.make("schema-person"),
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
			findEntitySchemaSandboxScriptBySlug: () =>
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-person"),
					sandboxScriptId: SandboxScriptId.make("person-script"),
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				if (input.entitySchemaId !== "schema-1") {
					return Effect.die("unexpected upsert for non-primary entity");
				}
				assert(storedEntity);
				return Effect.succeed(storedEntity);
			},
			create: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity create");
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				return Effect.succeed({
					...baseEntity,
					properties,
					name: input.name,
					populatedAt: null,
					externalId: input.externalId,
					id: EntityId.make("person-1"),
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
				});
			},
			update: (input) => {
				primaryWritten = true;
				assert(storedEntity);
				const properties: unknown = input.properties;
				assertRecord(properties);
				storedEntity = {
					...storedEntity,
					properties,
					name: input.name,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				};
				return Effect.succeed(storedEntity);
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProviderEntityPopulationWorkflow(
					{ ...payload, mode: "refresh", entitySchemaSlug: "book" },
					payload.executionId,
				),
			);

			expect(relationshipWritten).toBe(false);
			expect(primaryWritten).toBe(false);
			expect(storedEntity).toMatchObject({
				populatedAt: now,
				properties: { title: "Previous Book" },
			});
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
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					relatedEntityGroups: [
						{
							direction: "incoming",
							synchronization: "authoritative",
							relationshipSchemaSlug: "authored-by",
							entities: [
								{
									name: "Author",
									scriptSlug: "person.test",
									externalId: "person-ext-1",
									relationshipProperties: [],
								},
							],
						},
					],
				},
			}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findBuiltinBySlug: () =>
				Effect.succeed({
					isBuiltin: true,
					slug: "authored-by",
					name: "Authored By",
					propertiesSchema: { fields: {} },
					id: RelationshipSchemaId.make("rel-schema-1"),
					targetEntitySchemaId: EntitySchemaId.make("schema-1"),
					sourceEntitySchemaId: EntitySchemaId.make("schema-person"),
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: () =>
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-person"),
					sandboxScriptId: SandboxScriptId.make("person-script"),
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProviderEntityPopulationWorkflow({ ...payload, mode: "ensure" }, payload.executionId),
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
			findBuiltinBySlug: () =>
				Effect.succeed({
					isBuiltin: true,
					slug: "authored-by",
					name: "Authored By",
					id: RelationshipSchemaId.make("rel-schema-1"),
					targetEntitySchemaId: EntitySchemaId.make("schema-1"),
					sourceEntitySchemaId: EntitySchemaId.make("schema-person"),
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
			findEntitySchemaSandboxScriptBySlug: () =>
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-person"),
					sandboxScriptId: SandboxScriptId.make("person-script"),
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				const properties: unknown = input.properties;
				assertRecord(properties);
				const nextEntity = {
					...baseEntity,
					properties,
					name: input.name,
					externalId: input.externalId,
					id: EntityId.make("entity-1"),
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				};
				storedEntity = nextEntity;
				return Effect.succeed(nextEntity);
			},
			create: (input) => {
				if (input.scope !== "global") {
					return Effect.die("unexpected user entity create");
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				return Effect.succeed({
					...baseEntity,
					properties,
					name: input.name,
					populatedAt: null,
					externalId: input.externalId,
					id: EntityId.make("person-1"),
					entitySchemaId: input.entitySchemaId,
					sandboxScriptId: input.sandboxScriptId,
				});
			},
			update: (input) => {
				assert(storedEntity);
				const properties: unknown = input.properties;
				assertRecord(properties);
				storedEntity = {
					...storedEntity,
					properties,
					name: input.name,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				};
				return Effect.succeed(storedEntity);
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () =>
				Effect.sync(() => {
					relationshipWriteCount += 1;
					return savedRelationship;
				}),
		}),
	} satisfies TestLayerOptions;

	const runAttempt = (executionId: string, relationshipProperties: unknown) =>
		withTestLayer(
			{
				...options,
				processSandbox: () => {
					sandboxCalls += 1;
					return Effect.succeed({
						logs: [],
						error: null,
						status: "completed" as const,
						value: {
							name: "Test Book",
							properties: { title: "Test Book" },
							relatedEntityGroups: [
								{
									direction: "incoming",
									synchronization: "authoritative",
									relationshipSchemaSlug: "authored-by",
									entities: [
										{
											name: "Author",
											relationshipProperties,
											scriptSlug: "person.test",
											externalId: "person-ext-1",
										},
									],
								},
							],
						},
					});
				},
			},
			executionId,
			runProviderEntityPopulationWorkflow(
				{ ...importPayload, executionId, mode: "ensure" },
				executionId,
			),
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

it.effect("rolls back provider graph writes when a later child write fails", () => {
	const writes: string[] = [];
	const transactionRunner = Layer.succeed(
		TransactionRunner,
		<A, E, R>(effect: Effect.Effect<A, E, R>) => {
			const initialLength = writes.length;
			return Effect.provideService(effect, CurrentDb, Object.create(null)).pipe(
				Effect.tapErrorCause(() =>
					Effect.sync(() => {
						writes.length = initialLength;
					}),
				),
			);
		},
	);
	const payload = { ...importPayload, executionId: "atomic-graph-write" };
	const options = {
		transactionRunner,
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					childEntities: [
						{
							properties: {},
							name: "Missing Child",
							externalId: "missing-child",
							entitySchemaSlug: "missing-child",
						},
					],
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							relationshipSchemaSlug: "media-suggestion",
							entities: [
								{ name: "Suggestion", scriptSlug: "media.test", externalId: "suggestion-1" },
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaSandboxScriptBySlug: () =>
				Effect.succeed({
					entitySchemaId: EntitySchemaId.make("schema-related"),
					sandboxScriptId: SandboxScriptId.make("script-related"),
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) =>
				Effect.sync(() => {
					writes.push(`entity:${input.name}`);
					return {
						...baseEntity,
						name: input.name,
						id: EntityId.make("entity-1"),
						externalId: input.externalId,
						entitySchemaId: input.entitySchemaId,
						sandboxScriptId: input.sandboxScriptId,
						populatedAt: input.populatedAt?.toISOString() ?? null,
					};
				}),
			create: (input) =>
				Effect.sync(() => {
					writes.push(`entity:${input.name}`);
					return {
						...baseEntity,
						name: input.name,
						id: EntityId.make("suggestion-1"),
						entitySchemaId: input.entitySchemaId,
						externalId: input.scope === "global" ? input.externalId : null,
						populatedAt:
							input.scope === "global" ? (input.populatedAt?.toISOString() ?? null) : null,
						sandboxScriptId:
							input.scope === "global" ? input.sandboxScriptId : SandboxScriptId.make("script-1"),
					};
				}),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed(null),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: () =>
				Effect.sync(() => {
					writes.push("relationship:media-suggestion");
					return savedRelationship;
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProviderEntityPopulationWorkflow({ ...payload, mode: "ensure" }, payload.executionId),
			);

			expect(exit._tag).toBe("Failure");
			expect(writes).toEqual([]);
		}),
	);
});

it.effect("refresh synchronization replaces provider-owned primary and child values", () => {
	const writes: Array<{
		name: string;
		populatedAt: Date | null;
		entitySchemaId: EntitySchemaId;
		properties: Record<string, unknown>;
	}> = [];
	const relationshipSchema = {
		isBuiltin: true,
		name: "Show to Season",
		slug: "show-to-show-season",
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaId.make("show-season-schema"),
		sourceEntitySchemaId: EntitySchemaId.make("schema-1"),
		targetEntitySchemaId: EntitySchemaId.make("schema-season"),
	};
	const payload = { ...importPayload, executionId: "refresh-overwrite" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Updated Show",
					properties: { title: "Updated Show", productionStatus: "Ended" },
					childEntities: [
						{
							name: "Updated Season",
							externalId: "season-1",
							entitySchemaSlug: "show-season",
							properties: { seasonNumber: 1 },
						},
					],
				},
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed({ id: EntitySchemaId.make("schema-season") }),
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () => Effect.succeed(relationshipSchema),
		}),
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: (input) =>
				Effect.succeed({
					...baseEntity,
					populatedAt: now,
					entitySchemaId: input.entitySchemaId,
					id:
						input.entitySchemaId === "schema-1"
							? EntityId.make("entity-1")
							: EntityId.make("season-1"),
				}),
		}),
		entitiesService: makeEntitiesService({
			create: () => Effect.die("unexpected create when refreshing existing entities"),
			upsert: (input) => {
				assertRecord(input.properties);
				if (input.updateExisting) {
					writes.push({
						name: input.name,
						properties: input.properties,
						populatedAt: input.populatedAt,
						entitySchemaId: input.entitySchemaId,
					});
				}
				return Effect.succeed({
					...baseEntity,
					name: input.name,
					properties: input.properties,
					entitySchemaId: input.entitySchemaId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id:
						input.entitySchemaId === "schema-1"
							? EntityId.make("entity-1")
							: EntityId.make("season-1"),
				});
			},
			update: (input) => {
				assertRecord(input.properties);
				writes.push({
					name: input.name,
					properties: input.properties,
					populatedAt: input.populatedAt,
					entitySchemaId: input.entitySchemaId,
				});
				return Effect.succeed({
					...baseEntity,
					name: input.name,
					properties: input.properties,
					entitySchemaId: input.entitySchemaId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id:
						input.entitySchemaId === "schema-1"
							? EntityId.make("entity-1")
							: EntityId.make("season-1"),
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "refresh", entitySchemaSlug: "show" },
				payload.executionId,
			);

			expect(writes).toHaveLength(2);
			expect(writes[0]).toMatchObject({
				name: "Updated Season",
				properties: { seasonNumber: 1 },
				populatedAt: expect.any(Date),
				entitySchemaId: EntitySchemaId.make("schema-season"),
			});
			expect(writes[1]).toMatchObject({
				name: "Updated Show",
				populatedAt: expect.any(Date),
				entitySchemaId: EntitySchemaId.make("schema-1"),
				properties: { title: "Updated Show", productionStatus: "Ended" },
			});
		}),
	);
});

it.effect("dies when a refresh payload omits entitySchemaSlug", () => {
	let sandboxCalled = false;
	const payload = { ...importPayload, executionId: "exec-refresh-missing-slug" };
	const options = {
		processSandbox: () =>
			Effect.sync(() => {
				sandboxCalled = true;
				return {
					logs: [],
					error: null,
					status: "completed" as const,
					value: { name: "Test Book", properties: { title: "Test Book" } },
				};
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runProviderEntityPopulationWorkflow({ ...payload, mode: "refresh" }, payload.executionId),
			);

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				expect(exit.cause._tag).toBe("Die");
				if (exit.cause._tag === "Die") {
					expect(String(exit.cause.defect)).toContain("entitySchemaSlug is required");
				}
			}
			expect(sandboxCalled).toBe(false);
		}),
	);
});

it.effect("clears an explicit empty relationship group", () => {
	const calls: unknown[] = [];
	const payload = { ...importPayload, executionId: "clear-empty-group" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Book",
					properties: { title: "Test Book" },
					relatedEntityGroups: [
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "media-suggestion",
						},
					],
				},
			}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () =>
				Effect.succeed([
					{
						...savedRelationship,
						sourceEntityId: EntityId.make("entity-1"),
						targetEntityId: EntityId.make("stale-target"),
						relationshipSchemaId: mediaSuggestionSchema.id,
					},
				]),
			deleteRelationship: (input) =>
				Effect.sync(() => {
					calls.push(input);
					return {
						...savedRelationship,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaId: input.relationshipSchemaId,
					};
				}),
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "ensure" },
				payload.executionId,
			);
			expect(calls).toEqual([
				{
					scope: "global",
					sourceEntityId: EntityId.make("entity-1"),
					targetEntityId: EntityId.make("stale-target"),
					relationshipSchemaId: mediaSuggestionSchema.id,
				},
			]);
		}),
	);
});
