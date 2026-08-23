import { assert, expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { Database } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	databaseLayer,
	makeRedisService,
	makeWorkflowEngine,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import {
	LifecycleDispatch,
	type LifecycleDispatchInput,
	LifecycleDispatchNoop,
} from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import {
	EntityImportWorkflowOperations,
	type EntityImportWorkflowOperationsValue,
} from "./operations-workflow";
import { writeChildEntitySet } from "./population";
import {
	type ProviderEntityPopulationPayload,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";
import { EntityImportPayload } from "./schemas";

const TestEntityImportWorkflow = Workflow.make("TestEntityImportWorkflow", {
	success: ListedEntity,
	error: SandboxRunError,
	payload: EntityImportPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const now = "2026-06-14T00:00:00.000Z";

const baseEntity = {
	createdAt: now,
	updatedAt: now,
	populatedAt: now,
	name: "Test Record",
	externalId: "ext-1",
	id: EntityId.make("entity-1"),
	properties: { title: "Test Record" },
	entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
	providerId: SandboxProviderId.make("provider-1"),
} satisfies ListedEntity;

type ProviderEntity = Omit<ListedEntity, "properties"> & {
	properties: Record<string, unknown>;
};

type ProviderEntitySaveResult =
	ReturnType<EntitiesService["Service"]["upsert"]> extends Effect.Effect<
		infer Success,
		unknown,
		unknown
	>
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

const relatedSuggestionSchema = {
	isBuiltin: true,
	name: "Related Suggestion",
	slug: "related-suggestion",
	sourceEntitySchemaSlug: null,
	targetEntitySchemaSlug: null,
	propertiesSchema: { fields: {} },
	id: RelationshipSchemaSlug.make("related-suggestion-schema-id"),
};

const effectiveRelationshipSchemas = Object.fromEntries(
	[
		"cast-member-schema-id",
		"related-suggestion-schema-id",
		"rel-schema-1",
		"rel-part-part-item",
		"rel-group-part",
		"relationship-schema-id",
		"group-part-to-group-part-item",
		"group-to-group-part",
	].map((slug) => [
		slug,
		{
			slug,
			name: "Relationship",
			sourceEntitySchemaSlug: null,
			targetEntitySchemaSlug: null,
			propertiesSchema: { fields: {} },
		},
	]),
);

const baseEntitySchema = {
	slug: "record",
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
	["group-part", EntitySchemaSlug.make("schema-part")],
	["group-part-item", EntitySchemaSlug.make("schema-part-item")],
]);

const findChildEntitySchemaBySlug = (slug: string) => {
	const id = childEntitySchemaSlugs.get(slug);
	return Effect.succeed(id ? { id, propertiesSchema: { fields: {} } } : null);
};

const makePartItemChild = (externalId: string) => ({
	externalId,
	name: "Part Item",
	properties: { partItemNumber: 1 },
	entitySchemaSlug: "group-part-item",
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
	});

type EntitiesServiceOverrides = Omit<MockOverrides<typeof mockEntitiesService>, "upsert"> & {
	upsert?: (
		input: Parameters<EntitiesService["Service"]["upsert"]>[0],
	) => Effect.Effect<ProviderEntity>;
	upsertResult?: (
		input: Parameters<EntitiesService["Service"]["upsert"]>[0],
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
	});

const makeEntitySchemasRepository = (
	overrides: MockOverrides<typeof mockEntitySchemasRepository> = {},
) =>
	mockEntitySchemasRepository({
		getBuiltinBySlug: () => Effect.succeed(null),
		...overrides,
	});

const makeRelationshipSchemasRepository = (
	overrides: MockOverrides<typeof mockRelationshipSchemasRepository> = {},
) =>
	mockRelationshipSchemasRepository({
		findBuiltinBySlug: (slug: string) =>
			Effect.succeed(slug === "related-suggestion" ? relatedSuggestionSchema : null),
		findGlobalBySchemaIds: () => Effect.succeed(null),
		...overrides,
	});

type TestLayerOptions = {
	entitiesService?: Layer.Layer<EntitiesService>;
	lifecycleDispatch?: Layer.Layer<LifecycleDispatch>;
	databaseLayer?: Layer.Layer<Database>;
	entitiesRepository?: Layer.Layer<EntitiesRepository>;
	entitySchemasRepository?: Layer.Layer<EntitySchemasRepository>;
	relationshipsRepository?: Layer.Layer<RelationshipsRepository>;
	processSandbox?: EntityImportWorkflowOperationsValue["processSandbox"];
	relationshipSchemasRepository?: Layer.Layer<RelationshipSchemasRepository>;
};

const makeTestLayer = (options: TestLayerOptions) => {
	const relationshipsRepository = options.relationshipsRepository ?? makeRelationshipsRepository();

	const relationshipsServiceLayer = RelationshipsService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				options.databaseLayer ?? databaseLayer,
				relationshipsRepository,
				Layer.mock(PluginRuntimeResolver)({
					getEffectiveDefinitions: () =>
						Effect.succeed({
							savedViews: {},
							entitySchemas: {},
							signalSchemas: {},
							relationshipSchemas: effectiveRelationshipSchemas,
						}),
				}),
			),
		),
	);

	return Layer.mergeAll(
		options.databaseLayer ?? databaseLayer,
		relationshipsServiceLayer,
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(0) })),
		options.lifecycleDispatch ?? LifecycleDispatchNoop,
		Layer.mock(EntityImportWorkflowOperations, {
			runProviderImportAutomations: () => Effect.void,
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
					name: "Test Record",
					properties: { title: "Test Record" },
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
			expect(result.name).toBe("Test Record");
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
					name: "Test Record",
					properties: { title: "Test Record" },
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "additive" as const,
							relationshipSchemaSlug: "related-suggestion",
							entities: [
								{ externalId: "item-1", name: "Suggested Item", providerSlug: "item.test" },
							],
						},
					],
				},
			}),
		entitiesRepository: makeEntitiesRepository({
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("schema-item"),
					providerId: SandboxProviderId.make("item-provider"),
					detailsScriptId: SandboxScriptId.make("item-details"),
				}),
		}),
		entitiesService: makeEntitiesService({
			create: () =>
				Effect.succeed({
					...baseEntity,
					id: EntityId.make("suggested-item"),
					entitySchemaSlug: EntitySchemaSlug.make("schema-item"),
					providerId: SandboxProviderId.make("item-provider"),
				}),
		}),
		relationshipsRepository: makeRelationshipsRepository({
			listGlobalRelationships: () =>
				Effect.succeed([
					{
						...savedRelationship,
						sourceEntityId: baseEntity.id,
						relationshipSchemaSlug: relatedSuggestionSchema.id,
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
			"schema-1->schema-part",
			{
				isBuiltin: true,
				name: "Group to Group Part",
				slug: "group-to-group-part",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaSlug.make("rel-group-part"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
			},
		],
		[
			"schema-part->schema-part-item",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Group Part to Group Part Item",
				slug: "group-part-to-group-part-item",
				id: RelationshipSchemaSlug.make("rel-part-part-item"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-part-item"),
			},
		],
	]);
	const options = {
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: (slug: string) => {
				let result: { id: EntitySchemaSlug; propertiesSchema: { fields: {} } } | null = null;
				switch (slug) {
					case "group-part": {
						result = {
							id: EntitySchemaSlug.make("schema-part"),
							propertiesSchema: { fields: {} },
						};
						break;
					}
					case "group-part-item": {
						result = {
							id: EntitySchemaSlug.make("schema-part-item"),
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

	const runScopes = (executionId: string, syncExisting: boolean, discoverPartItem: boolean) => {
		const part = {
			name: "Part 1",
			externalId: "part-1",
			entitySchemaSlug: "group-part",
			properties: {
				partNumber: 1,
				description: "Part",
				releaseDate: "2026-01-01",
				images: [{ type: "remote", url: "https://example.com/part.jpg", purpose: "cover" }],
			},
			childEntities: [
				{
					name: "Part Item 1",
					externalId: "part-item-1",
					entitySchemaSlug: "group-part-item",
					properties: {
						runtime: 45,
						partNumber: 1,
						partItemNumber: 1,
						description: "Part Item",
						publishDate: "2026-01-02",
					},
				},
				...(discoverPartItem
					? [
							{
								name: "Part Item 2",
								externalId: "part-item-2",
								entitySchemaSlug: "group-part-item",
								properties: {
									runtime: 45,
									partNumber: 1,
									partItemNumber: 2,
									description: "Part Item",
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
				const processedParts = yield* writeChildEntitySet({
					syncExisting,
					childEntities: [part],
					parentEntityId: baseEntity.id,
					providerId: SandboxProviderId.make("provider-1"),
					parentEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
				});
				const processedPart = processedParts.processedChildren[0];
				assert(processedPart);
				yield* writeChildEntitySet({
					syncExisting,
					childEntities: part.childEntities,
					parentEntityId: processedPart.entity.id,
					providerId: SandboxProviderId.make("provider-1"),
					parentEntitySchemaSlug: processedPart.entitySchemaSlug,
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
			"list:rel-group-part:entity-1",
			"create:rel-group-part:entity-1->schema-part-part-1",
			"list:rel-part-part-item:schema-part-part-1",
			"create:rel-part-part-item:schema-part-part-1->schema-part-item-part-item-1",
		]);

		const part = entityWrites.find((write) => write.externalId === "part-1");
		const partItem = entityWrites.find((write) => write.externalId === "part-item-1");

		expect(part?.providerId).toBe("provider-1");
		expect(part?.entitySchemaSlug).toBe("schema-part");
		expect(part?.properties).toEqual({
			partNumber: 1,
			description: "Part",
			releaseDate: "2026-01-01",
			images: [{ type: "remote", url: "https://example.com/part.jpg", purpose: "cover" }],
		});
		expect(partItem?.entitySchemaSlug).toBe("schema-part-item");
		expect(partItem?.properties).toEqual({
			runtime: 45,
			partNumber: 1,
			partItemNumber: 1,
			description: "Part Item",
			publishDate: "2026-01-02",
		});

		relationshipOperations.length = 0;
		entityWrites.length = 0;
		yield* runScopes("exec-child-tree-refresh", true, true);

		expect(storedRelationships.size).toBe(3);
		expect(entityWrites).toHaveLength(3);
		expect(entityWrites.every((write) => write.updateExisting)).toBe(true);
		expect(relationshipOperations).toEqual([
			"list:rel-group-part:entity-1",
			"list:rel-part-part-item:schema-part-part-1",
			"create:rel-part-part-item:schema-part-part-1->schema-part-item-part-item-2",
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
							entitySchemaSlug: "group-part",
						},
						{
							name: "Part Item",
							externalId: "part-item-mismatch",
							properties: {},
							entitySchemaSlug: "group-part-item",
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
					expectedChildEntitySchemaSlug: "group-part-item",
					parentEntitySchemaSlug: EntitySchemaSlug.make("schema-1"),
					childEntities: [
						{
							name: "Container",
							externalId: "declared-mismatch",
							properties: {},
							entitySchemaSlug: "group-part",
						},
					],
				}),
			),
		);
		expect(declaredMismatch).toBeInstanceOf(SandboxRunError);
		expect(declaredMismatch.message).toBe(
			"Child entity schema does not match declared schema: group-part !== group-part-item",
		);
		expect(entityWrites).toEqual([]);

		relationshipOperations.length = 0;
		yield* withTestLayer(
			options,
			"exec-empty-authoritative-children",
			writeChildEntitySet({
				syncExisting: true,
				childEntities: [],
				expectedChildEntitySchemaSlug: "group-part-item",
				providerId: SandboxProviderId.make("provider-1"),
				parentEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
				parentEntityId: EntityId.make("schema-part-part-1"),
			}),
		);
		expect(relationshipOperations).toEqual([
			"list:rel-part-part-item:schema-part-part-1",
			"delete:rel-part-part-item:schema-part-part-1->schema-part-item-part-item-1",
			"delete:rel-part-part-item:schema-part-part-1->schema-part-item-part-item-2",
		]);
		expect(storedRelationships.size).toBe(1);
	});
});

it.effect("propagates images through properties for the primary entity", () => {
	const savedProperties: unknown[] = [];

	const payload = { ...importPayload, executionId: "exec-images-properties" };
	const images = [{ type: "local" as const, key: "permanent/test-record.jpg", purpose: "cover" }];
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { name: "Test Record", properties: { title: "Test Record", images } },
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
				{ title: "Test Record", images },
				{ title: "Test Record", images },
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
	const itemSchemaScript = {
		entitySchemaSlug: EntitySchemaSlug.make("schema-item"),
		providerId: SandboxProviderId.make("item-provider"),
		detailsScriptId: SandboxScriptId.make("item-details"),
	};
	const payload = { ...importPayload, executionId: "exec-suggestions" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Record",
					properties: { title: "Test Record" },
					relatedEntityGroups: [
						{
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "related-suggestion",
							entities: [
								{ externalId: "item-1", providerSlug: "item.alpha", name: "Recommended Item" },
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
				Effect.succeed(slug === "item.alpha" ? itemSchemaScript : null),
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
					externalId: "item-1",
					name: "Recommended Item",
					entitySchemaSlug: EntitySchemaSlug.make("schema-item"),
					providerId: SandboxProviderId.make("item-provider"),
				},
			]);
			expect(relationshipWrites).toEqual([
				expect.objectContaining({
					properties: {},
					scope: "global",
					sourceEntityId: EntityId.make("entity-1"),
					relationshipSchemaSlug: relatedSuggestionSchema.id,
					targetEntityId: EntityId.make("suggestion-item-1"),
				}),
			]);
		}),
	);
});

it.effect("replaces stale synced suggestions on a later import run", () => {
	let storedPrimaryEntity: StoredEntity | null = null;
	const currentTargets = new Set<string>();
	const syncCalls: Array<ReadonlyArray<EntityId>> = [];
	const itemSchemaScript = {
		entitySchemaSlug: EntitySchemaSlug.make("schema-item"),
		providerId: SandboxProviderId.make("item-provider"),
		detailsScriptId: SandboxScriptId.make("item-details"),
	};
	const makeStoredRelationship = (targetEntityId: EntityId) => ({
		targetEntityId,
		properties: {},
		createdAt: now,
		wasInserted: true,
		sourceEntityId: baseEntity.id,
		id: RelationshipId.make("relationship-1"),
		relationshipSchemaSlug: relatedSuggestionSchema.id,
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
							name: "Test Record",
							properties: { title: "Test Record" },
							relatedEntityGroups: [
								{
									entities: suggestions,
									direction: "outgoing",
									synchronization: "authoritative",
									relationshipSchemaSlug: "related-suggestion",
								},
							],
						},
					}),
				entitiesRepository: makeEntitiesRepository({
					findEntitySchemaProviderBySlug: (slug: string) =>
						Effect.succeed(slug === "item.alpha" ? itemSchemaScript : null),
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
							properties: { title: "Test Record" },
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
				externalId: "item-1",
				providerSlug: "item.alpha",
				name: "First Recommendation",
			},
		]);
		yield* runAttempt("exec-suggestions-replace-2", [
			{
				externalId: "item-2",
				providerSlug: "item.alpha",
				name: "Second Recommendation",
			},
		]);

		expect(syncCalls).toEqual([
			[EntityId.make("suggestion-item-1")],
			[EntityId.make("suggestion-item-2")],
		]);
		expect([...currentTargets]).toEqual(["suggestion-item-2"]);
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
					name: "Test Record",
					relatedEntityGroups: [],
					properties: { title: "Test Record" },
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

			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message).toBe("Sandbox script execution failed");
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
		properties: { title: "Previous Record" },
	};
	const payload = { ...importPayload, executionId: "exec-related-validation" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Record",
					properties: { title: "Test Record" },
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
					targetEntitySchemaSlug: EntitySchemaSlug.make("record"),
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
				if (input.entitySchemaSlug !== "record") {
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
					{ ...payload, mode: "refresh", entitySchemaSlug: EntitySchemaSlug.make("record") },
					payload.executionId,
				),
			);

			expect(relationshipWritten).toBe(false);
			expect(primaryWritten).toBe(false);
			expect(storedEntity).toMatchObject({
				populatedAt: now,
				properties: { title: "Previous Record" },
			});
			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message).toContain("rating");
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
					name: "Test Record",
					properties: { title: "Test Record" },
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
			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message.length).toBeGreaterThan(0);
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
							name: "Test Record",
							properties: { title: "Test Record" },
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
	const transactionDatabaseLayer = Layer.succeed(
		Database,
		Database.of(
			Object.assign(Object.create(null), {
				transaction: ((callback) => {
					const initialLength = writes.length;
					return callback(Object.create(null)).pipe(
						Effect.tapCause(() =>
							Effect.sync(() => {
								writes.length = initialLength;
							}),
						),
					);
				}) satisfies Database["Service"]["transaction"],
			}),
		),
	);
	const payload = { ...importPayload, executionId: "partial-scope-commit" };
	const options = {
		databaseLayer: transactionDatabaseLayer,
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Test Record",
					properties: { title: "Test Record" },
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
							relationshipSchemaSlug: "related-suggestion",
							entities: [
								{ name: "Suggestion", providerSlug: "example.test", externalId: "suggestion-1" },
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
					writes.push("relationship:related-suggestion");
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
				"entity:Test Record",
				"entity:Suggestion",
				"relationship:related-suggestion",
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
		name: "Group to Part",
		slug: "group-to-group-part",
		propertiesSchema: { fields: {} },
		id: RelationshipSchemaSlug.make("group-to-group-part"),
		sourceEntitySchemaSlug: EntitySchemaSlug.make("group"),
		targetEntitySchemaSlug: EntitySchemaSlug.make("group-part"),
	};
	const payload = { ...importPayload, executionId: "refresh-overwrite" };
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: {
					name: "Updated Group",
					properties: { title: "Updated Group", productionStatus: "Ended" },
					childEntities: [
						{
							name: "Updated Part",
							externalId: "part-1",
							properties: { partNumber: 1 },
							entitySchemaSlug: "group-part",
						},
					],
				},
			}),
		entitySchemasRepository: makeEntitySchemasRepository({
			getBuiltinBySlug: () =>
				Effect.succeed({
					id: EntitySchemaSlug.make("group-part"),
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
						input.entitySchemaSlug === "group"
							? EntityId.make("entity-1")
							: EntityId.make("part-1"),
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
						input.entitySchemaSlug === "group"
							? EntityId.make("entity-1")
							: EntityId.make("part-1"),
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
						input.entitySchemaSlug === "group"
							? EntityId.make("entity-1")
							: EntityId.make("part-1"),
				});
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runProviderEntityPopulationWorkflow(
				{ ...payload, mode: "refresh", entitySchemaSlug: EntitySchemaSlug.make("group") },
				payload.executionId,
			);

			expect(writes).toHaveLength(2);
			expect(writes[0]).toMatchObject({
				name: "Updated Part",
				properties: { partNumber: 1 },
				populatedAt: expect.any(Date),
				entitySchemaSlug: EntitySchemaSlug.make("group-part"),
			});
			expect(writes[1]).toMatchObject({
				name: "Updated Group",
				populatedAt: expect.any(Date),
				entitySchemaSlug: EntitySchemaSlug.make("group"),
				properties: { title: "Updated Group", productionStatus: "Ended" },
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
					value: { name: "Test Record", properties: { title: "Test Record" } },
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

			assert(Exit.isFailure(exit));
			const dieReason = exit.cause.reasons.find(Cause.isDieReason);
			assert(dieReason);
			expect(String(dieReason.defect)).toContain("entitySchemaSlug is required");
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
					name: "Test Record",
					properties: { title: "Test Record" },
					relatedEntityGroups: [
						{
							entities: [],
							direction: "outgoing",
							synchronization: "authoritative",
							relationshipSchemaSlug: "related-suggestion",
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
						relationshipSchemaSlug: relatedSuggestionSchema.id,
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
					relationshipSchemaPluginId: null,
					sourceEntityId: EntityId.make("entity-1"),
					relationshipSchemaSlug: relatedSuggestionSchema.id,
					targetEntityId: EntityId.make("stale-target"),
				},
			]);
		}),
	);
});

it.effect("resumes from the failed population scope without duplicating committed work", () => {
	let failPartTwo = true;
	let stamped = false;
	const storedEntities = new Map<string, StoredEntity>();
	const storedRelationships = new Map<string, typeof savedRelationship>();
	const relationshipSchemas = new Map([
		[
			"schema-group->schema-part",
			{
				isBuiltin: true,
				name: "Group to Group Part",
				slug: "group-to-group-part",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaSlug.make("rel-group-part"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-group"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
			},
		],
		[
			"schema-part->schema-part-item",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Group Part to Group Part Item",
				slug: "group-part-to-group-part-item",
				id: RelationshipSchemaSlug.make("rel-part-part-item"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-part-item"),
			},
		],
	]);
	const sandboxValue = {
		name: "Severance",
		properties: { title: "Severance" },
		childEntities: [
			{
				name: "Part 1",
				externalId: "part-1",
				entitySchemaSlug: "group-part",
				properties: { partNumber: 1 },
				childEntities: [
					{
						name: "Part Item 1",
						externalId: "part-item-1",
						entitySchemaSlug: "group-part-item",
						properties: { partItemNumber: 1 },
					},
				],
			},
			{
				name: "Part 2",
				externalId: "part-2",
				entitySchemaSlug: "group-part",
				properties: { partNumber: 2 },
				childEntities: [
					{
						name: "Part Item 3",
						externalId: "part-item-3",
						entitySchemaSlug: "group-part-item",
						properties: { partItemNumber: 1 },
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
				if (failPartTwo && input.externalId === "part-item-3") {
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
					externalId: "alpha-group-1",
					entitySchemaSlug: EntitySchemaSlug.make("schema-group"),
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
		expect(storedEntities.get(entityKey("schema-group", "alpha-group-1"))?.populatedAt).toBeNull();

		failPartTwo = false;
		const result = yield* runPopulation("exec-scope-resume-2");

		expect(result.populatedAt).not.toBeNull();
		expect(storedEntities.size).toBe(5);
		expect(storedRelationships.size).toBe(4);
		expect(
			storedEntities.get(entityKey("schema-group", "alpha-group-1"))?.populatedAt,
		).not.toBeNull();
	});
});

it.effect("uses unique deterministic activity names per population scope", () => {
	const relationshipSchemas = new Map([
		[
			"schema-group->schema-part",
			{
				isBuiltin: true,
				name: "Group to Group Part",
				slug: "group-to-group-part",
				propertiesSchema: { fields: {} },
				id: RelationshipSchemaSlug.make("rel-group-part"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-group"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
			},
		],
		[
			"schema-part->schema-part-item",
			{
				isBuiltin: true,
				propertiesSchema: { fields: {} },
				name: "Group Part to Group Part Item",
				slug: "group-part-to-group-part-item",
				id: RelationshipSchemaSlug.make("rel-part-part-item"),
				sourceEntitySchemaSlug: EntitySchemaSlug.make("schema-part"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("schema-part-item"),
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
		["related-suggestion", relatedSuggestionSchema],
	]);
	const sandboxValue = {
		name: "Severance",
		properties: { title: "Severance" },
		childEntities: [
			{
				name: "Part 1",
				externalId: "part-1",
				entitySchemaSlug: "group-part",
				properties: { partNumber: 1 },
				childEntities: [makePartItemChild("part-item-1")],
			},
			{
				name: "Part 2",
				externalId: "part-2",
				entitySchemaSlug: "group-part",
				properties: { partNumber: 2 },
				childEntities: [makePartItemChild("part-item-3")],
			},
		],
		relatedEntityGroups: [
			{
				entities: [],
				direction: "outgoing",
				synchronization: "authoritative",
				relationshipSchemaSlug: "related-suggestion",
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
		let engine: WorkflowEngine["Service"];
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
				externalId: "alpha-group-1",
				executionId: "exec-activity-names",
				entitySchemaSlug: EntitySchemaSlug.make("schema-group"),
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
			"sync-related-entity-group:0:related-suggestion",
			"sync-related-entity-group:1:cast-member",
			"write-child-entity-set:alpha-group-1",
			"write-child-entity-set:part-1",
			"write-child-entity-set:part-2",
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
		externalId: "group-1",
		id: EntityId.make("group-1"),
		entitySchemaSlug: EntitySchemaSlug.make("group"),
	};
	const partEntity = {
		...baseEntity,
		name: "Part 1",
		externalId: "part-1",
		properties: { partNumber: 1 },
		id: EntityId.make("part-1"),
		entitySchemaSlug: EntitySchemaSlug.make("group-part"),
	};
	const secondPartEntity = {
		...partEntity,
		name: "Part 2",
		externalId: "part-2",
		properties: { partNumber: 2 },
		id: EntityId.make("part-2"),
	};
	const partItemBefore = {
		...baseEntity,
		name: "Pilot",
		externalId: "part-item-1",
		properties: { partItemNumber: 1 },
		id: EntityId.make("part-item-1"),
		entitySchemaSlug: EntitySchemaSlug.make("group-part-item"),
	};
	const partItemAfter = { ...partItemBefore, name: "Premiere" };
	const noop = (entity: ProviderEntity): ProviderEntitySaveResult => {
		const value = providerSnapshot(entity);
		return { entity, outcome: { before: value, after: value, operation: "noop" } };
	};
	const relationshipSchemas = new Map([
		[
			"group->group-part",
			{
				isBuiltin: true,
				name: "Group Parts",
				slug: "group-to-group-part",
				propertiesSchema: { fields: {} },
				sourceEntitySchemaSlug: EntitySchemaSlug.make("group"),
				id: RelationshipSchemaSlug.make("group-to-group-part"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("group-part"),
			},
		],
		[
			"group-part->group-part-item",
			{
				isBuiltin: true,
				name: "Group Part Items",
				propertiesSchema: { fields: {} },
				slug: "group-part-to-group-part-item",
				sourceEntitySchemaSlug: EntitySchemaSlug.make("group-part"),
				targetEntitySchemaSlug: EntitySchemaSlug.make("group-part-item"),
				id: RelationshipSchemaSlug.make("group-part-to-group-part-item"),
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
					expectedChildEntitySchemaSlug: "group-part",
					childEntities: [
						{
							name: "Part 1",
							externalId: "part-1",
							properties: { partNumber: 1 },
							entitySchemaSlug: "group-part",
							expectedChildEntitySchemaSlug: "group-part-item",
							childEntities: [
								{
									name: "Premiere",
									externalId: "part-item-1",
									properties: { partItemNumber: 1 },
									entitySchemaSlug: "group-part-item",
								},
							],
						},
						{
							name: "Part 2",
							childEntities: [],
							externalId: "part-2",
							properties: { partNumber: 2 },
							entitySchemaSlug: "group-part",
							expectedChildEntitySchemaSlug: "group-part-item",
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
					slug === "group-part" || slug === "group-part-item"
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
				if (input.externalId === "part-1") {
					return Effect.succeed(noop(partEntity));
				}
				if (input.externalId === "part-2") {
					return Effect.succeed(noop(secondPartEntity));
				}
				if (input.externalId === "part-item-1") {
					return Effect.succeed({
						entity: partItemAfter,
						outcome: {
							operation: "update",
							before: providerSnapshot(partItemBefore),
							after: providerSnapshot(partItemAfter),
						},
					});
				}
				return Effect.succeed(noop(rootEntity));
			},
		}),
	} satisfies TestLayerOptions;
	const payload = {
		...importPayload,
		externalId: "group-1",
		mode: "refresh" as const,
		entitySchemaSlug: EntitySchemaSlug.make("group"),
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
				recordId: "part-item-1",
				origin: { kind: "provider_refresh" },
				source: {
					kind: "entity",
					before: { name: "Pilot" },
					after: { name: "Premiere" },
				},
				population: {
					rootPreviouslyPopulated: true,
					parentEntity: {
						name: "Part 1",
						properties: { partNumber: 1 },
						entitySchemaSlug: "group-part",
					},
					scopeEntity: { id: "group-1", name: "Severance", entitySchemaSlug: "group" },
				},
			});
			const relationshipDispatches = dispatched.filter(
				({ source }) => source.kind === "relationship",
			);
			const partDispatches = relationshipDispatches.filter(
				({ source }) =>
					source.kind === "relationship" &&
					source.after?.relationshipSchemaSlug === "group-to-group-part",
			);
			expect(partDispatches).toHaveLength(2);
			expect(partDispatches.filter(({ population }) => population?.batch?.isLeader)).toHaveLength(
				1,
			);
			expect(new Set(partDispatches.map(({ population }) => population?.batch?.id)).size).toBe(1);
			for (const dispatch of partDispatches) {
				expect(dispatch.population?.batch).toMatchObject({
					afterCount: 2,
					beforeCount: 0,
					createdCount: 2,
					deletedCount: 0,
					updatedCount: 0,
				});
			}
			const partItemDispatch = relationshipDispatches.find(
				({ source }) =>
					source.kind === "relationship" &&
					source.after?.relationshipSchemaSlug === "group-part-to-group-part-item",
			);
			assert(partItemDispatch);
			expect(partItemDispatch.population?.batch).toMatchObject({
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
