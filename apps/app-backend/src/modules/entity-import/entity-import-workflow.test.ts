import { assert, expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
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
	makeWorkflowEngine,
	makeWorkflowActivityEngine,
	transactionLayer,
} from "#lib/test-utils/effect";
import {
	LifecycleDispatch,
	type LifecycleDispatchInput,
	LifecycleDispatchNoop,
} from "#modules/entities/lifecycle-dispatch";
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
import { writeChildEntitySet } from "./population";
import {
	type ProviderEntityPopulationPayload,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";

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
	entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
	providerId: SandboxProviderId.make("provider-1"),
} satisfies ListedEntity;

type ProviderEntity = Omit<ListedEntity, "properties"> & {
	properties: Record<string, unknown>;
};

type ProviderEntitySaveResult =
	ReturnType<EntitiesService["upsert"]> extends Effect.Effect<infer Success, unknown, unknown>
		? Success
		: never;

const providerSnapshot = (entity: ProviderEntity) => ({
	id: entity.id,
	name: entity.name,
	properties: entity.properties,
	entitySchemaSlug: entity.entitySchemaSlug,
});

const savedRelationship = {
	properties: {},
	createdAt: now,
	wasInserted: true,
	id: RelationshipId.make("relationship-1"),
	sourceEntityId: EntityId.make("source-entity-id"),
	targetEntityId: EntityId.make("target-entity-id"),
	relationshipSchemaSlug: RelationshipSchemaSlug.make("relationship-schema-id"),
};

const relationshipForInput = (
	input: {
		sourceEntityId: EntityId;
		targetEntityId: EntityId;
		properties?: Record<string, unknown>;
		relationshipSchemaSlug: RelationshipSchemaSlug;
	},
	wasInserted = true,
) => ({
	...savedRelationship,
	wasInserted,
	properties: input.properties ?? {},
	sourceEntityId: input.sourceEntityId,
	targetEntityId: input.targetEntityId,
	relationshipSchemaSlug: input.relationshipSchemaSlug,
});

const mediaSuggestionSchema = {
	isBuiltin: true,
	name: "Media Suggestion",
	slug: "media-suggestion",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("media-suggestion-schema-id"),
};

const baseEntitySchema = {
	slug: "book",
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

const entityKey = (entitySchemaSlug: string, externalId: string) =>
	`${entitySchemaSlug}:${externalId}`;

const childEntitySchemaSlugs = new Map([
	["show-season", EntitySchemaSlug.make("schema-season")],
	["show-episode", EntitySchemaSlug.make("schema-episode")],
]);

const findChildEntitySchemaBySlug = (slug: string) => {
	const id = childEntitySchemaSlugs.get(slug);
	return Effect.succeed(id ? { id, propertiesSchema: { fields: {} } } : null);
};

const makeEpisodeChild = (externalId: string) => ({
	externalId,
	name: "Episode",
	properties: { episodeNumber: 1 },
	entitySchemaSlug: "show-episode",
});

const mockEntitiesRepository = Layer.mock(EntitiesRepository);
const mockEntitiesService = Layer.mock(EntitiesService);
const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
const mockEntitySchemasRepository = Layer.mock(EntitySchemasRepository);
const mockRelationshipSchemasRepository = Layer.mock(RelationshipSchemasRepository);

const makeEntitiesRepository = (overrides: MockOverrides<typeof mockEntitiesRepository> = {}) =>
	mockEntitiesRepository({
		listEntityReferencesByIds: (entityIds) =>
			Effect.succeed(
				entityIds.map((id) => ({ id, name: `Entity ${id}`, entitySchemaSlug: "test-entity" })),
			),
		findEntitySchemaProviderBySlug: () => Effect.succeed(null),
		findGlobalEntityByExternalId: () => Effect.succeed(null),
		findEntitySchemaById: () => Effect.succeed(baseEntitySchema),
		...overrides,
		_tag: "EntitiesRepository",
	});

type EntitiesServiceOverrides = Omit<MockOverrides<typeof mockEntitiesService>, "upsert"> & {
	upsert?: (input: Parameters<EntitiesService["upsert"]>[0]) => Effect.Effect<ProviderEntity>;
	upsertResult?: (
		input: Parameters<EntitiesService["upsert"]>[0],
	) => Effect.Effect<ProviderEntitySaveResult>;
};

const toProviderSaveResult = (entity: ProviderEntity) => {
	const snapshot = {
		id: entity.id,
		name: entity.name,
		properties: entity.properties,
		entitySchemaSlug: EntitySchemaSlug.make("test-entity"),
	};
	return { entity, outcome: { before: snapshot, after: snapshot, operation: "noop" as const } };
};

const makeEntitiesService = (overrides: EntitiesServiceOverrides = {}) => {
	const { upsert, upsertResult, ...serviceOverrides } = overrides;
	return mockEntitiesService({
		create: () => Effect.succeed(baseEntity),
		update: () => Effect.succeed(baseEntity),
		upsert: (input) =>
			upsertResult
				? upsertResult(input)
				: (upsert ? upsert(input) : Effect.succeed(baseEntity)).pipe(
						Effect.map(toProviderSaveResult),
					),
		...serviceOverrides,
		_tag: "EntitiesService",
	});
};

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		createRelationship: (input) => Effect.succeed(relationshipForInput(input)),
		updateRelationship: (input) => Effect.succeed(relationshipForInput(input, false)),
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
	lifecycleDispatch?: Layer.Layer<LifecycleDispatch>;
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
		options.lifecycleDispatch ?? LifecycleDispatchNoop,
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
	origin: { kind: "api" } as const,
	userId: UserId.make("user-1"),
	providerId: SandboxProviderId.make("provider-1"),
	entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
};

it.effect("populates entity and writes related entities", () => {
	let relationshipWritten = false;
	let staleRelationshipDeleted = false;
	let globalEntityWritten = false;
	let relatedEntityWritten = false;

	const payload = { ...importPayload, executionId: "exec-full" };
	const relatedEntitySchemaSandboxScript = {
		entitySchemaSlug: EntitySchemaSlug.make("schema-person"),
		providerId: SandboxProviderId.make("person-provider"),
		detailsScriptId: SandboxScriptId.make("person-details"),
	};
	const relationshipSchema = {
		isBuiltin: true,
		slug: "authored-by",
		name: "Authored By",
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaSlug.make("rel-schema-1"),
		targetEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
		sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-person"),
	};
	const relatedEntity = {
		name: "Author",
		createdAt: now,
		updatedAt: now,
		properties: {},
		populatedAt: null,
		externalId: "person-ext-1",
		id: EntityId.make("person-1"),
		entitySchemaSlug: EntitySchemaSlug.make("schema-person"),
		providerId: SandboxProviderId.make("person-provider"),
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
									providerSlug: "person.test",
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
			findEntitySchemaProviderBySlug: () => Effect.succeed(relatedEntitySchemaSandboxScript),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () =>
				Effect.succeed([
					{
						...savedRelationship,
						targetEntityId: baseEntity.id,
						relationshipSchemaSlug: relationshipSchema.id,
						sourceEntityId: EntityId.make("person-stale"),
					},
				]),
			createRelationship: (input) =>
				Effect.sync(() => {
					relationshipWritten = true;
					return relationshipForInput(input);
				}),
			deleteRelationship: () =>
				Effect.sync(() => {
					staleRelationshipDeleted = true;
					return savedRelationship;
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				if (input.entitySchemaSlug !== "schema-1") {
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
								{ externalId: "movie-1", name: "Suggested Movie", providerSlug: "movie.test" },
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("schema-movie"),
					providerId: SandboxProviderId.make("movie-provider"),
					detailsScriptId: SandboxScriptId.make("movie-details"),
				}),
		}),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.succeed({
					...baseEntity,
					id: EntityId.make("suggested-movie"),
					entitySchemaSlug: EntitySchemaSlug.make("schema-movie"),
					providerId: SandboxProviderId.make("movie-provider"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () =>
				Effect.succeed([
					{
						...savedRelationship,
						sourceEntityId: baseEntity.id,
						relationshipSchemaSlug: mediaSuggestionSchema.id,
						targetEntityId: EntityId.make("stale-target"),
					},
				]),
			createRelationship: (input) =>
				Effect.sync(() => {
					created = true;
					return relationshipForInput(input);
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

it.effect("walks the child entity tree one scope per parent and upserts each node", () => {
	const relationshipOperations: string[] = [];
	const storedRelationships = new Map<string, typeof savedRelationship>();
	const entityWrites: Array<{
		name: string;
		externalId: string;
		properties: unknown;
		updateExisting: boolean;
		entitySchemaSlug: EntitySchemaSlug;
		providerId: SandboxProviderId;
	}> = [];
	const relationshipSchemas = new Map([
		[
			"schema-1->schema-season",
			{
				isBuiltin: true,
				name: "Show to Show Season",
				slug: "show-to-show-season",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaSlug.make("rel-show-season"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
			},
		],
		[
			"schema-season->schema-episode",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Show Season to Show Episode",
				slug: "show-season-to-show-episode",
				id: RelationshipSchemaSlug.make("rel-season-episode"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-episode"),
			},
		],
	]);
	const options = {
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug: string) => {
				let result: { id: EntitySchemaSlug; propertiesSchema: { fields: {} } } | null = null;
				switch (slug) {
					case "show-season": {
						result = {
							id: EntitySchemaSlug.make("schema-season"),
							propertiesSchema: { fields: {} },
						};
						break;
					}
					case "show-episode": {
						result = {
							id: EntitySchemaSlug.make("schema-episode"),
							propertiesSchema: { fields: {} },
						};
						break;
					}
				}
				return Effect.succeed(result);
			},
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: (input) =>
				Effect.succeed(
					relationshipSchemas.get(
						`${input.sourceEntitySchemaSlug}->${input.targetEntitySchemaSlug}`,
					) ?? null,
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
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
				});
				return Effect.succeed({
					...baseEntity,
					properties,
					name: input.name,
					externalId: input.externalId,
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id: EntityId.make(`${input.entitySchemaSlug}-${input.externalId}`),
				});
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: (input) =>
				Effect.sync(() => {
					const identity = `${input.relationshipSchemaSlug}:${input.sourceEntityId}->${input.targetEntityId}`;
					relationshipOperations.push(`create:${identity}`);
					const existing = storedRelationships.get(identity);
					if (existing) {
						return { ...existing, wasInserted: false };
					}
					const relationship = {
						...savedRelationship,
						properties: input.properties,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaSlug: input.relationshipSchemaSlug,
						id: RelationshipId.make(`relationship-${storedRelationships.size + 1}`),
					};
					storedRelationships.set(identity, relationship);
					return relationship;
				}),
			listGlobalRelationships: (input) =>
				Effect.sync(() => {
					relationshipOperations.push(
						`list:${input.relationshipSchemaSlug}:${input.type === "anchored" ? input.anchorEntityId : "self"}`,
					);
					return [...storedRelationships.values()].filter((relationship) => {
						if (relationship.relationshipSchemaSlug !== input.relationshipSchemaSlug) {
							return false;
						}
						if (input.type === "self") {
							return relationship.sourceEntityId === relationship.targetEntityId;
						}
						return input.direction === "outgoing"
							? relationship.sourceEntityId === input.anchorEntityId
							: relationship.targetEntityId === input.anchorEntityId;
					});
				}),
			deleteRelationship: (input) =>
				Effect.sync(() => {
					const identity = `${input.relationshipSchemaSlug}:${input.sourceEntityId}->${input.targetEntityId}`;
					relationshipOperations.push(`delete:${identity}`);
					const relationship = storedRelationships.get(identity) ?? savedRelationship;
					storedRelationships.delete(identity);
					return relationship;
				}),
		}),
	} satisfies TestLayerOptions;

	const runScopes = (executionId: string, syncExisting: boolean, discoverEpisode: boolean) => {
		const season = {
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
				...(discoverEpisode
					? [
							{
								name: "Episode 2",
								externalId: "episode-2",
								entitySchemaSlug: "show-episode",
								properties: {
									runtime: 45,
									seasonNumber: 1,
									episodeNumber: 2,
									description: "Episode",
									publishDate: "2026-01-09",
								},
							},
						]
					: []),
			],
		};
		return withTestLayer(
			options,
			executionId,
			Effect.gen(function* () {
				const processedSeasons = yield* writeChildEntitySet({
					syncExisting,
					childEntities: [season],
					parentEntityId: baseEntity.id,
					providerId: SandboxProviderId.make("provider-1"),
					parentEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
				});
				const processedSeason = processedSeasons.processedChildren[0];
				assert(processedSeason);
				yield* writeChildEntitySet({
					syncExisting,
					childEntities: season.childEntities,
					parentEntityId: processedSeason.entity.id,
					providerId: SandboxProviderId.make("provider-1"),
					parentEntitySchemaSlug: processedSeason.entitySchemaSlug,
				});
			}),
		);
	};

	return Effect.gen(function* () {
		yield* runScopes("exec-child-tree-initial", false, false);

		expect(storedRelationships.size).toBe(2);
		expect(entityWrites).toHaveLength(2);
		expect(entityWrites.every((write) => !write.updateExisting)).toBe(true);
		expect(relationshipOperations).toEqual([
			"list:rel-show-season:entity-1",
			"create:rel-show-season:entity-1->schema-season-season-1",
			"list:rel-season-episode:schema-season-season-1",
			"create:rel-season-episode:schema-season-season-1->schema-episode-episode-1",
		]);

		const season = entityWrites.find((write) => write.externalId === "season-1");
		const episode = entityWrites.find((write) => write.externalId === "episode-1");

		expect(season?.providerId).toBe("provider-1");
		expect(season?.entitySchemaSlug).toBe("schema-season");
		expect(season?.properties).toEqual({
			seasonNumber: 1,
			description: "Season",
			releaseDate: "2026-01-01",
			images: [{ type: "remote", url: "https://example.com/season.jpg" }],
		});
		expect(episode?.entitySchemaSlug).toBe("schema-episode");
		expect(episode?.properties).toEqual({
			runtime: 45,
			seasonNumber: 1,
			episodeNumber: 1,
			description: "Episode",
			publishDate: "2026-01-02",
		});

		relationshipOperations.length = 0;
		entityWrites.length = 0;
		yield* runScopes("exec-child-tree-refresh", true, true);

		expect(storedRelationships.size).toBe(3);
		expect(entityWrites).toHaveLength(3);
		expect(entityWrites.every((write) => write.updateExisting)).toBe(true);
		expect(relationshipOperations).toEqual([
			"list:rel-show-season:entity-1",
			"list:rel-season-episode:schema-season-season-1",
			"create:rel-season-episode:schema-season-season-1->schema-episode-episode-2",
		]);

		entityWrites.length = 0;
		const mismatch = yield* Effect.flip(
			withTestLayer(
				options,
				"exec-mismatched-children",
				writeChildEntitySet({
					syncExisting: true,
					providerId: SandboxProviderId.make("provider-1"),
					parentEntityId: baseEntity.id,
					parentEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
					childEntities: [
						{
							name: "Container",
							externalId: "container-mismatch",
							properties: {},
							entitySchemaSlug: "show-season",
						},
						{
							name: "Episode",
							externalId: "episode-mismatch",
							properties: {},
							entitySchemaSlug: "show-episode",
						},
					],
				}),
			),
		);
		expect(mismatch).toBeInstanceOf(SandboxRunError);
		expect(mismatch.message).toBe("Child entities must use one entity schema");
		expect(entityWrites).toEqual([]);
		const declaredMismatch = yield* Effect.flip(
			withTestLayer(
				options,
				"exec-declared-child-mismatch",
				writeChildEntitySet({
					syncExisting: true,
					providerId: SandboxProviderId.make("provider-1"),
					parentEntityId: baseEntity.id,
					expectedChildEntitySchemaSlug: "show-episode",
					parentEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
					childEntities: [
						{
							name: "Container",
							externalId: "declared-mismatch",
							properties: {},
							entitySchemaSlug: "show-season",
						},
					],
				}),
			),
		);
		expect(declaredMismatch).toBeInstanceOf(SandboxRunError);
		expect(declaredMismatch.message).toBe(
			"Child entity schema does not match declared schema: show-season !== show-episode",
		);
		expect(entityWrites).toEqual([]);

		relationshipOperations.length = 0;
		yield* withTestLayer(
			options,
			"exec-empty-authoritative-children",
			writeChildEntitySet({
				syncExisting: true,
				childEntities: [],
				expectedChildEntitySchemaSlug: "show-episode",
				providerId: SandboxProviderId.make("provider-1"),
				parentEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
				parentEntityId: EntityId.make("schema-season-season-1"),
			}),
		);
		expect(relationshipOperations).toEqual([
			"list:rel-season-episode:schema-season-season-1",
			"delete:rel-season-episode:schema-season-season-1->schema-episode-episode-1",
			"delete:rel-season-episode:schema-season-season-1->schema-episode-episode-2",
		]);
		expect(storedRelationships.size).toBe(1);
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
		entitySchemaSlug: EntitySchemaSlug;
		providerId: SandboxProviderId;
		properties: Record<string, unknown>;
	}> = [];
	const movieSchemaScript = {
		entitySchemaSlug: EntitySchemaSlug.make("schema-movie"),
		providerId: SandboxProviderId.make("movie-provider"),
		detailsScriptId: SandboxScriptId.make("movie-details"),
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
								{ externalId: "movie-1", providerSlug: "movie.tmdb", name: "Recommended Movie" },
								{
									externalId: "missing-1",
									name: "Missing Suggestion",
									providerSlug: "missing.provider",
								},
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaProviderBySlug: (slug: string) =>
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
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
				});
				return Effect.succeed({
					...baseEntity,
					properties,
					name: input.name,
					populatedAt: null,
					externalId: input.externalId,
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
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
						relationshipSchemaSlug: input.relationshipSchemaSlug,
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
					properties: {},
					populatedAt: null,
					externalId: "movie-1",
					name: "Recommended Movie",
					entitySchemaSlug: EntitySchemaSlug.make("schema-movie"),
					providerId: SandboxProviderId.make("movie-provider"),
				},
			]);
			expect(relationshipWrites).toEqual([
				expect.objectContaining({
					properties: {},
					scope: "global",
					sourceEntityId: EntityId.make("entity-1"),
					relationshipSchemaSlug: mediaSuggestionSchema.id,
					targetEntityId: EntityId.make("suggestion-movie-1"),
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
		entitySchemaSlug: EntitySchemaSlug.make("schema-movie"),
		providerId: SandboxProviderId.make("movie-provider"),
		detailsScriptId: SandboxScriptId.make("movie-details"),
	};
	const makeStoredRelationship = (targetEntityId: EntityId) => ({
		targetEntityId,
		properties: {},
		createdAt: now,
		wasInserted: true,
		sourceEntityId: baseEntity.id,
		id: RelationshipId.make("relationship-1"),
		relationshipSchemaSlug: mediaSuggestionSchema.id,
	});

	const runAttempt = (
		executionId: string,
		suggestions: ReadonlyArray<{ name: string; externalId: string; providerSlug: string }>,
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
					findEntitySchemaProviderBySlug: (slug: string) =>
						Effect.succeed(slug === "movie.tmdb" ? movieSchemaScript : null),
					findGlobalEntityByExternalId: () => Effect.succeed(storedPrimaryEntity),
				}),
				entitiesService: makeEntitiesService({
					upsert: (input) => {
						if (input.entitySchemaSlug !== importPayload.entitySchemaSlug) {
							return Effect.die("unexpected upsert for non-primary entity");
						}
						storedPrimaryEntity = {
							...baseEntity,
							name: input.name,
							populatedAt: null,
							externalId: input.externalId,
							properties: { title: "Test Book" },
							entitySchemaSlug: input.entitySchemaSlug,
							providerId: input.providerId,
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
							entitySchemaSlug: input.entitySchemaSlug,
							providerId: input.providerId,
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
								relationshipSchemaSlug: input.relationshipSchemaSlug,
							};
						}),
					deleteRelationship: (input) =>
						Effect.sync(() => {
							currentTargets.delete(input.targetEntityId);
							return {
								...savedRelationship,
								sourceEntityId: input.sourceEntityId,
								targetEntityId: input.targetEntityId,
								relationshipSchemaSlug: input.relationshipSchemaSlug,
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
				providerSlug: "movie.tmdb",
				name: "First Recommendation",
			},
		]);
		yield* runAttempt("exec-suggestions-replace-2", [
			{
				externalId: "movie-2",
				providerSlug: "movie.tmdb",
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
				value: { name: "Test Book", relatedEntityGroups: [], properties: { title: "Test Book" } },
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
			return Effect.succeed({ logs: [], value: {}, error: null, status: "completed" as const });
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
	let storedEntity: StoredEntity | null = { ...baseEntity, properties: { title: "Previous Book" } };
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
									providerSlug: "person.test",
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
					id: RelationshipSchemaSlug.make("rel-schema-1"),
					targetEntitySchemaSlug: EntitySchemaSlug.make("book"),
					sourceEntitySchemaSlug: EntitySchemaSlug.make("person"),
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
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("person"),
					providerId: SandboxProviderId.make("person-provider"),
					detailsScriptId: SandboxScriptId.make("person-details"),
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				if (input.entitySchemaSlug !== "book") {
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
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
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
					{ ...payload, mode: "refresh", entitySchemaSlug: EntitySchemaSlug.make("book") },
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
									providerSlug: "person.test",
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
					id: RelationshipSchemaSlug.make("rel-schema-1"),
					targetEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
					sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-person"),
				}),
		}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("schema-person"),
					providerId: SandboxProviderId.make("person-provider"),
					detailsScriptId: SandboxScriptId.make("person-details"),
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
	let sandboxCalls = 0;
	let relationshipWriteCount = 0;
	let storedEntity: StoredEntity | null = null;

	const options = {
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findBuiltinBySlug: () =>
				Effect.succeed({
					isBuiltin: true,
					slug: "authored-by",
					name: "Authored By",
					id: RelationshipSchemaSlug.make("rel-schema-1"),
					targetEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
					sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-person"),
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
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("schema-person"),
					providerId: SandboxProviderId.make("person-provider"),
					detailsScriptId: SandboxScriptId.make("person-details"),
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
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
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
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
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
			createRelationship: (input) =>
				Effect.sync(() => {
					relationshipWriteCount += 1;
					return relationshipForInput(input);
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
											providerSlug: "person.test",
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

it.effect("commits earlier population scopes when a later scope fails", () => {
	const writes: string[] = [];
	let stamped = false;
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
	const payload = { ...importPayload, executionId: "partial-scope-commit" };
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
								{ name: "Suggestion", providerSlug: "media.test", externalId: "suggestion-1" },
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("schema-related"),
					providerId: SandboxProviderId.make("provider-related"),
					detailsScriptId: SandboxScriptId.make("related-details"),
				}),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) =>
				Effect.sync(() => {
					writes.push(`entity:${input.name}`);
					return {
						...baseEntity,
						name: input.name,
						externalId: input.externalId,
						id: EntityId.make("entity-1"),
						entitySchemaSlug: input.entitySchemaSlug,
						providerId: input.providerId,
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
						entitySchemaSlug: input.entitySchemaSlug,
						externalId: input.scope === "global" ? input.externalId : null,
						populatedAt:
							input.scope === "global" ? (input.populatedAt?.toISOString() ?? null) : null,
						providerId:
							input.scope === "global" ? input.providerId : SandboxProviderId.make("provider-1"),
					};
				}),
			update: () =>
				Effect.sync(() => {
					stamped = true;
					return baseEntity;
				}),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () => Effect.succeed(null),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: (input) =>
				Effect.sync(() => {
					writes.push("relationship:media-suggestion");
					return relationshipForInput(input);
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
			expect(stamped).toBe(false);
			expect(writes).toEqual([
				"entity:Test Book",
				"entity:Suggestion",
				"relationship:media-suggestion",
			]);
		}),
	);
});

it.effect("refresh synchronization replaces provider-owned primary and child values", () => {
	const writes: Array<{
		name: string;
		populatedAt: Date | null;
		entitySchemaSlug: EntitySchemaSlug;
		properties: Record<string, unknown>;
	}> = [];
	const relationshipSchema = {
		isBuiltin: true,
		name: "Show to Season",
		slug: "show-to-show-season",
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaSlug.make("show-to-show-season"),
		sourceEntitySchemaSlug: EntitySchemaSlug.make("show"),
		targetEntitySchemaSlug: EntitySchemaSlug.make("show-season"),
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
							properties: { seasonNumber: 1 },
							entitySchemaSlug: "show-season",
						},
					],
				},
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () =>
				Effect.succeed({
					id: EntitySchemaSlug.make("show-season"),
					propertiesSchema: { fields: {} },
				}),
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: () => Effect.succeed(relationshipSchema),
		}),
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: (input) =>
				Effect.succeed({
					...baseEntity,
					populatedAt: now,
					entitySchemaSlug: input.entitySchemaSlug,
					id:
						input.entitySchemaSlug === "show"
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
						entitySchemaSlug: input.entitySchemaSlug,
					});
				}
				return Effect.succeed({
					...baseEntity,
					name: input.name,
					properties: input.properties,
					entitySchemaSlug: input.entitySchemaSlug,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id:
						input.entitySchemaSlug === "show"
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
					entitySchemaSlug: input.entitySchemaSlug,
				});
				return Effect.succeed({
					...baseEntity,
					name: input.name,
					properties: input.properties,
					entitySchemaSlug: input.entitySchemaSlug,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id:
						input.entitySchemaSlug === "show"
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
				{ ...payload, mode: "refresh", entitySchemaSlug: EntitySchemaSlug.make("show") },
				payload.executionId,
			);

			expect(writes).toHaveLength(2);
			expect(writes[0]).toMatchObject({
				name: "Updated Season",
				properties: { seasonNumber: 1 },
				populatedAt: expect.any(Date),
				entitySchemaSlug: EntitySchemaSlug.make("show-season"),
			});
			expect(writes[1]).toMatchObject({
				name: "Updated Show",
				populatedAt: expect.any(Date),
				entitySchemaSlug: EntitySchemaSlug.make("show"),
				properties: { title: "Updated Show", productionStatus: "Ended" },
			});
		}),
	);
});

it.effect("dies when a refresh payload omits entitySchemaSlug", () => {
	let sandboxCalled = false;
	const payload = { ...importPayload, executionId: "exec-refresh-missing-slug" };
	const invalidPayload: ProviderEntityPopulationPayload = { ...payload, mode: "refresh" };
	Reflect.deleteProperty(invalidPayload, "entitySchemaSlug");
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
				runProviderEntityPopulationWorkflow(invalidPayload, payload.executionId),
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
						relationshipSchemaSlug: mediaSuggestionSchema.id,
					},
				]),
			deleteRelationship: (input) =>
				Effect.sync(() => {
					calls.push(input);
					return {
						...savedRelationship,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaSlug: input.relationshipSchemaSlug,
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
					relationshipSchemaSlug: mediaSuggestionSchema.id,
				},
			]);
		}),
	);
});

it.effect("resumes from the failed population scope without duplicating committed work", () => {
	let failSeasonTwo = true;
	let stamped = false;
	const storedEntities = new Map<string, StoredEntity>();
	const storedRelationships = new Map<string, typeof savedRelationship>();
	const relationshipSchemas = new Map([
		[
			"schema-show->schema-season",
			{
				isBuiltin: true,
				name: "Show to Show Season",
				slug: "show-to-show-season",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaSlug.make("rel-show-season"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-show"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
			},
		],
		[
			"schema-season->schema-episode",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Show Season to Show Episode",
				slug: "show-season-to-show-episode",
				id: RelationshipSchemaSlug.make("rel-season-episode"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-episode"),
			},
		],
	]);
	const sandboxValue = {
		name: "Severance",
		properties: { title: "Severance" },
		childEntities: [
			{
				name: "Season 1",
				externalId: "season-1",
				entitySchemaSlug: "show-season",
				properties: { seasonNumber: 1 },
				childEntities: [
					{
						name: "Episode 1",
						externalId: "episode-1",
						entitySchemaSlug: "show-episode",
						properties: { episodeNumber: 1 },
					},
				],
			},
			{
				name: "Season 2",
				externalId: "season-2",
				entitySchemaSlug: "show-season",
				properties: { seasonNumber: 2 },
				childEntities: [
					{
						name: "Episode 3",
						externalId: "episode-3",
						entitySchemaSlug: "show-episode",
						properties: { episodeNumber: 1 },
					},
				],
			},
		],
	};
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				value: sandboxValue,
				status: "completed" as const,
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: findChildEntitySchemaBySlug,
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: (input) =>
				Effect.succeed(
					relationshipSchemas.get(
						`${input.sourceEntitySchemaSlug}->${input.targetEntitySchemaSlug}`,
					) ?? null,
				),
		}),
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: (input) =>
				Effect.succeed(
					storedEntities.get(entityKey(input.entitySchemaSlug, input.externalId)) ?? null,
				),
		}),
		entitiesService: makeEntitiesService({
			upsert: (input) => {
				if (failSeasonTwo && input.externalId === "episode-3") {
					return Effect.die(new Error("transient store failure"));
				}
				const properties: unknown = input.properties;
				assertRecord(properties);
				const key = entityKey(input.entitySchemaSlug, input.externalId);
				const entity = {
					...baseEntity,
					properties,
					name: input.name,
					externalId: input.externalId,
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					id:
						storedEntities.get(key)?.id ??
						EntityId.make(`${input.entitySchemaSlug}-${input.externalId}`),
				};
				storedEntities.set(key, entity);
				return Effect.succeed(entity);
			},
			update: (input) => {
				stamped = true;
				const entry = [...storedEntities.values()].find((entity) => entity.id === input.entityId);
				assert(entry);
				const next = { ...entry, populatedAt: input.populatedAt?.toISOString() ?? null };
				storedEntities.set(entityKey(entry.entitySchemaSlug, entry.externalId), next);
				return Effect.succeed(next);
			},
		}),
		relationshipsRepository: makeRelationshipsRepository({
			createRelationship: (input) =>
				Effect.sync(() => {
					const identity = `${input.relationshipSchemaSlug}:${input.sourceEntityId}->${input.targetEntityId}`;
					const existing = storedRelationships.get(identity);
					if (existing) {
						return { ...existing, wasInserted: false };
					}
					const relationship = {
						...savedRelationship,
						properties: input.properties,
						sourceEntityId: input.sourceEntityId,
						targetEntityId: input.targetEntityId,
						relationshipSchemaSlug: input.relationshipSchemaSlug,
						id: RelationshipId.make(`relationship-${storedRelationships.size + 1}`),
					};
					storedRelationships.set(identity, relationship);
					return relationship;
				}),
			listGlobalRelationships: (input) =>
				Effect.sync(() =>
					[...storedRelationships.values()].filter((relationship) => {
						if (relationship.relationshipSchemaSlug !== input.relationshipSchemaSlug) {
							return false;
						}
						if (input.type === "self") {
							return relationship.sourceEntityId === relationship.targetEntityId;
						}
						return input.direction === "outgoing"
							? relationship.sourceEntityId === input.anchorEntityId
							: relationship.targetEntityId === input.anchorEntityId;
					}),
				),
		}),
	} satisfies TestLayerOptions;

	const runPopulation = (executionId: string) =>
		withTestLayer(
			options,
			executionId,
			runProviderEntityPopulationWorkflow(
				{
					...importPayload,
					executionId,
					mode: "ensure",
					externalId: "tmdb-show-1",
					entitySchemaSlug: EntitySchemaSlug.make("schema-show"),
				},
				executionId,
			),
		);

	return Effect.gen(function* () {
		const firstExit = yield* Effect.exit(runPopulation("exec-scope-resume-1"));

		expect(firstExit._tag).toBe("Failure");
		expect(stamped).toBe(false);
		expect(storedEntities.size).toBe(4);
		expect(storedRelationships.size).toBe(3);
		expect(storedEntities.get(entityKey("schema-show", "tmdb-show-1"))?.populatedAt).toBeNull();

		failSeasonTwo = false;
		const result = yield* runPopulation("exec-scope-resume-2");

		expect(result.populatedAt).not.toBeNull();
		expect(storedEntities.size).toBe(5);
		expect(storedRelationships.size).toBe(4);
		expect(storedEntities.get(entityKey("schema-show", "tmdb-show-1"))?.populatedAt).not.toBeNull();
	});
});

it.effect("uses unique deterministic activity names per population scope", () => {
	const relationshipSchemas = new Map([
		[
			"schema-show->schema-season",
			{
				isBuiltin: true,
				name: "Show to Show Season",
				slug: "show-to-show-season",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaSlug.make("rel-show-season"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-show"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
			},
		],
		[
			"schema-season->schema-episode",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Show Season to Show Episode",
				slug: "show-season-to-show-episode",
				id: RelationshipSchemaSlug.make("rel-season-episode"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-season"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-episode"),
			},
		],
	]);
	const castMemberSchema = {
		isBuiltin: true,
		name: "Cast Member",
		slug: "cast-member",
		sourceEntitySchemaSlug: null,
		targetEntitySchemaSlug: null,
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaSlug.make("cast-member-schema-id"),
	};
	const builtinRelationshipSchemas = new Map([
		["cast-member", castMemberSchema],
		["media-suggestion", mediaSuggestionSchema],
	]);
	const sandboxValue = {
		name: "Severance",
		properties: { title: "Severance" },
		childEntities: [
			{
				name: "Season 1",
				externalId: "season-1",
				entitySchemaSlug: "show-season",
				properties: { seasonNumber: 1 },
				childEntities: [makeEpisodeChild("episode-1")],
			},
			{
				name: "Season 2",
				externalId: "season-2",
				entitySchemaSlug: "show-season",
				properties: { seasonNumber: 2 },
				childEntities: [makeEpisodeChild("episode-3")],
			},
		],
		relatedEntityGroups: [
			{
				entities: [],
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "media-suggestion",
			},
			{
				entities: [],
				direction: "incoming",
				synchronization: "additive",
				relationshipSchemaSlug: "cast-member",
			},
		],
	};
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				value: sandboxValue,
				status: "completed" as const,
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: findChildEntitySchemaBySlug,
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findBuiltinBySlug: (slug: string) =>
				Effect.succeed(builtinRelationshipSchemas.get(slug) ?? null),
			findGlobalBySchemaIds: (input) =>
				Effect.succeed(
					relationshipSchemas.get(
						`${input.sourceEntitySchemaSlug}->${input.targetEntitySchemaSlug}`,
					) ?? null,
				),
		}),
	} satisfies TestLayerOptions;

	const runObserved = (activityNames: string[]) => {
		const instance = WorkflowInstance.initial(TestEntityImportWorkflow, "exec-activity-names");
		let engine: WorkflowEngine["Type"];
		engine = makeWorkflowEngine({
			activityExecute: (activity) =>
				Effect.gen(function* () {
					activityNames.push(activity.name);
					const exit = yield* Effect.exit(
						activity.execute.pipe(
							Effect.provideService(WorkflowEngine, engine),
							Effect.provideService(WorkflowInstance, instance),
						),
					);
					return new Workflow.Complete({ exit });
				}),
		});
		return runProviderEntityPopulationWorkflow(
			{
				...importPayload,
				mode: "ensure",
				externalId: "tmdb-show-1",
				executionId: "exec-activity-names",
				entitySchemaSlug: EntitySchemaSlug.make("schema-show"),
			},
			"exec-activity-names",
		).pipe(
			Effect.provideService(WorkflowEngine, engine),
			Effect.provideService(WorkflowInstance, instance),
			Effect.provide(makeTestLayer(options)),
		);
	};

	return Effect.gen(function* () {
		const firstRunNames: string[] = [];
		yield* runObserved(firstRunNames);

		expect(firstRunNames).toEqual([
			"check-existing-entity",
			"validate-entity-details",
			"upsert-root-entity",
			"sync-related-entity-group:0:media-suggestion",
			"sync-related-entity-group:1:cast-member",
			"write-child-entity-set:tmdb-show-1",
			"write-child-entity-set:season-1",
			"write-child-entity-set:season-2",
			"stamp-root-populated-at",
			"publish-primary-entity",
		]);
		expect(new Set(firstRunNames).size).toBe(firstRunNames.length);

		const secondRunNames: string[] = [];
		yield* runObserved(secondRunNames);

		expect(secondRunNames).toEqual(firstRunNames);
	});
});

it.effect("dispatches only material nested entity updates with the root population scope", () => {
	const dispatched: LifecycleDispatchInput[] = [];
	const rootEntity = {
		...baseEntity,
		name: "Old Severance",
		externalId: "show-1",
		id: EntityId.make("show-1"),
		entitySchemaSlug: EntitySchemaSlug.make("show"),
	};
	const seasonEntity = {
		...baseEntity,
		name: "Season 1",
		externalId: "season-1",
		properties: { seasonNumber: 1 },
		id: EntityId.make("season-1"),
		entitySchemaSlug: EntitySchemaSlug.make("show-season"),
	};
	const secondSeasonEntity = {
		...seasonEntity,
		name: "Season 2",
		externalId: "season-2",
		properties: { seasonNumber: 2 },
		id: EntityId.make("season-2"),
	};
	const episodeBefore = {
		...baseEntity,
		name: "Pilot",
		externalId: "episode-1",
		properties: { episodeNumber: 1 },
		id: EntityId.make("episode-1"),
		entitySchemaSlug: EntitySchemaSlug.make("show-episode"),
	};
	const episodeAfter = { ...episodeBefore, name: "Premiere" };
	const noop = (entity: ProviderEntity): ProviderEntitySaveResult => {
		const value = providerSnapshot(entity);
		return { entity, outcome: { before: value, after: value, operation: "noop" } };
	};
	const relationshipSchemas = new Map([
		[
			"show->show-season",
			{
				isBuiltin: true,
				name: "Show Seasons",
				slug: "show-to-show-season",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: EntitySchemaSlug.make("show"),
				id: RelationshipSchemaSlug.make("show-to-show-season"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("show-season"),
			},
		],
		[
			"show-season->show-episode",
			{
				isBuiltin: true,
				name: "Show Episodes",
				propertiesSchema: { fields: {} },
				slug: "show-season-to-show-episode",
				sourceEntitySchemaSlug: EntitySchemaSlug.make("show-season"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("show-episode"),
				id: RelationshipSchemaSlug.make("show-season-to-show-episode"),
			},
		],
	]);
	const options = {
		lifecycleDispatch: Layer.succeed(LifecycleDispatch, {
			dispatch: (input) => Effect.sync(() => dispatched.push(input)).pipe(Effect.asVoid),
		}),
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Severance",
					properties: {},
					expectedChildEntitySchemaSlug: "show-season",
					childEntities: [
						{
							name: "Season 1",
							externalId: "season-1",
							properties: { seasonNumber: 1 },
							entitySchemaSlug: "show-season",
							expectedChildEntitySchemaSlug: "show-episode",
							childEntities: [
								{
									name: "Premiere",
									externalId: "episode-1",
									properties: { episodeNumber: 1 },
									entitySchemaSlug: "show-episode",
								},
							],
						},
						{
							name: "Season 2",
							childEntities: [],
							externalId: "season-2",
							properties: { seasonNumber: 2 },
							entitySchemaSlug: "show-season",
							expectedChildEntitySchemaSlug: "show-episode",
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findGlobalEntityByExternalId: () => Effect.succeed(rootEntity),
		}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug: string) =>
				Effect.succeed(
					slug === "show-season" || slug === "show-episode"
						? { id: EntitySchemaSlug.make(slug), propertiesSchema: { fields: {} } }
						: null,
				),
		}),
		relationshipSchemasRepository: makeRelationshipSchemasRepository({
			findGlobalBySchemaIds: (input) =>
				Effect.succeed(
					relationshipSchemas.get(
						`${input.sourceEntitySchemaSlug}->${input.targetEntitySchemaSlug}`,
					) ?? null,
				),
		}),
		entitiesService: makeEntitiesService({
			upsertResult: (input) => {
				if (input.externalId === "season-1") {
					return Effect.succeed(noop(seasonEntity));
				}
				if (input.externalId === "season-2") {
					return Effect.succeed(noop(secondSeasonEntity));
				}
				if (input.externalId === "episode-1") {
					return Effect.succeed({
						entity: episodeAfter,
						outcome: {
							operation: "update",
							before: providerSnapshot(episodeBefore),
							after: providerSnapshot(episodeAfter),
						},
					});
				}
				return Effect.succeed(noop(rootEntity));
			},
		}),
	} satisfies TestLayerOptions;
	const payload = {
		...importPayload,
		externalId: "show-1",
		mode: "refresh" as const,
		entitySchemaSlug: EntitySchemaSlug.make("show"),
		origin: { kind: "provider_refresh" as const },
	};

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(payload, payload.executionId);
			expect(dispatched).toHaveLength(4);
			const entityDispatch = dispatched.find(({ source }) => source.kind === "entity");
			assert(entityDispatch);
			expect(entityDispatch).toMatchObject({
				operation: "update",
				recordId: "episode-1",
				origin: { kind: "provider_refresh" },
				source: {
					kind: "entity",
					before: { name: "Pilot" },
					after: { name: "Premiere" },
				},
				population: {
					rootPreviouslyPopulated: true,
					parentEntity: {
						name: "Season 1",
						properties: { seasonNumber: 1 },
						entitySchemaSlug: "show-season",
					},
					scopeEntity: { id: "show-1", name: "Severance", entitySchemaSlug: "show" },
				},
			});
			const relationshipDispatches = dispatched.filter(
				({ source }) => source.kind === "relationship",
			);
			const seasonDispatches = relationshipDispatches.filter(
				({ source }) =>
					source.kind === "relationship" &&
					source.after?.relationshipSchemaSlug === "show-to-show-season",
			);
			expect(seasonDispatches).toHaveLength(2);
			expect(seasonDispatches.filter(({ population }) => population?.batch?.isLeader)).toHaveLength(
				1,
			);
			expect(new Set(seasonDispatches.map(({ population }) => population?.batch?.id)).size).toBe(1);
			for (const dispatch of seasonDispatches) {
				expect(dispatch.population?.batch).toMatchObject({
					afterCount: 2,
					beforeCount: 0,
					createdCount: 2,
					deletedCount: 0,
					updatedCount: 0,
				});
			}
			const episodeDispatch = relationshipDispatches.find(
				({ source }) =>
					source.kind === "relationship" &&
					source.after?.relationshipSchemaSlug === "show-season-to-show-episode",
			);
			assert(episodeDispatch);
			expect(episodeDispatch.population?.batch).toMatchObject({
				isLeader: true,
				afterCount: 1,
				beforeCount: 0,
				createdCount: 1,
				deletedCount: 0,
				updatedCount: 0,
			});
			expect(new Set(relationshipDispatches.map(({ occurrenceId }) => occurrenceId)).size).toBe(3);
		}),
	);
});
