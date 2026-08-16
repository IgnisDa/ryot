import { expect, it } from "@effect/vitest";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Exit, Layer } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import { makeRedisService, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { planFixture } from "#modules/automations/lifecycle.test-support";
import {
	DefinitionRegistry,
	type DefinitionSnapshot,
	definitionSourceFromSnapshot,
	makeDefinitionRegistry,
} from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { writeChildEntitySet } from "./population";
import {
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";
import { syncRelatedEntityGroup } from "./relationship-population";

const now = IsoUtcString.make("2026-09-16T00:00:00.000Z");
const userId = UserId.make("user-1");
const providerId = SandboxProviderId.make("provider-1");
const rootEntityId = EntityId.make("root-1");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const childSchemaSlug = EntitySchemaSlug.make("part");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("record-part");
const epoch = new Date(0);

const command = rootLifecycleCommand({
	occurredAt: now,
	source: "provider-refresh",
	itemIdentity: "provider-population",
	initiator: { id: userId, kind: "user" },
	executionId: AutomationExecutionId.make("provider-population"),
	providerExecutionId: AutomationExecutionId.make("provider-workflow"),
});

const entityDefinition = (slug: string) => ({
	slug,
	name: slug,
	icon: "circle",
	pluginSlug: null,
	eventSchemas: {},
	mergeIdentityProperties: [],
	propertiesSchema: { fields: {} },
});

const definitions = {
	savedViews: {},
	signalSchemas: {},
	entitySchemas: {
		person: entityDefinition("person"),
		[rootSchemaSlug]: entityDefinition(rootSchemaSlug),
		[childSchemaSlug]: entityDefinition(childSchemaSlug),
	},
	relationshipSchemas: {
		credits: {
			slug: "credits",
			name: "Credits",
			pluginId: "private-plugin",
			propertiesSchema: { fields: {} },
			targetEntitySchemaSlug: "person",
			sourceEntitySchemaSlug: rootSchemaSlug,
		},
		[relationshipSchemaSlug]: {
			name: "Parts",
			slug: relationshipSchemaSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: childSchemaSlug,
		},
	},
} satisfies DefinitionSnapshot;
const registry = makeDefinitionRegistry(definitionSourceFromSnapshot(definitions));

const population = {
	rootPreviouslyPopulated: true,
	parentEntity: { name: "Record", properties: {}, entitySchemaSlug: rootSchemaSlug },
	scopeEntity: { name: "Record", id: rootEntityId, entitySchemaSlug: rootSchemaSlug },
} satisfies AutomationPopulationContext;

const listedEntity = (input: {
	id: EntityId;
	name: string;
	externalId: string;
	properties?: Record<string, JsonValue>;
	populatedAt?: string | null;
	entitySchemaSlug: EntitySchemaSlug;
	providerId?: SandboxProviderId;
}) =>
	({
		id: input.id,
		createdAt: now,
		updatedAt: now,
		name: input.name,
		externalId: input.externalId,
		properties: input.properties ?? {},
		entitySchemaSlug: input.entitySchemaSlug,
		providerId: input.providerId ?? providerId,
		populatedAt: input.populatedAt === undefined ? now : input.populatedAt,
	}) satisfies ListedEntity;

type TestEntity = ReturnType<typeof listedEntity>;

const snapshot = (entity: TestEntity) => ({
	id: entity.id,
	name: entity.name,
	createdAt: entity.createdAt,
	updatedAt: entity.updatedAt,
	properties: entity.properties,
	externalId: entity.externalId,
	providerId: entity.providerId,
	populatedAt: entity.populatedAt,
	entitySchemaSlug: entity.entitySchemaSlug,
});

const makeTransaction = (rollback: () => void = () => {}) => {
	let inTransaction = false;
	const transaction: Parameters<Parameters<Database["Service"]["transaction"]>[0]>[0] =
		Object.create(null);
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: ((body) =>
				Effect.suspend(() => {
					inTransaction = true;
					return body(transaction).pipe(
						Effect.onExit((exit) =>
							Effect.sync(() => {
								if (Exit.isFailure(exit)) {
									rollback();
								}
							}),
						),
						Effect.ensuring(Effect.sync(() => (inTransaction = false))),
					);
				})) satisfies Database["Service"]["transaction"],
		}),
	);
	return { database, inTransaction: () => inTransaction };
};

type PlannedEntityWork = Effect.Success<
	ReturnType<EntitiesService["Service"]["persistPlannedProviderUpsert"]>
>;
type PlannedEntityUpserts = EntitiesService["Service"]["persistPlannedProviderUpserts"];

const childEntityUpserts =
	(record: (input: Parameters<typeof childEntityWork>[0]) => void): PlannedEntityUpserts =>
	(input) =>
		Effect.sync(() => {
			const works = input.items.map((item) => {
				record(item);
				return childEntityWork(item);
			});
			return {
				results: works.map(({ result }) => result),
				plans: [...works.flatMap(({ plans }) => plans), planFixture("entities-batch")],
			};
		});

const childEntityWork = (
	input: Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0],
): PlannedEntityWork => {
	const entity = listedEntity({
		name: input.name,
		externalId: input.externalId,
		providerId: input.providerId,
		entitySchemaSlug: input.entitySchemaSlug,
		id: EntityId.make(`entity-${input.externalId}`),
		populatedAt: input.populatedAt?.toISOString() ?? null,
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- provider upsert input carries the plain JSON records these tests supply
		properties: input.properties as Record<string, JsonValue>,
	});
	return {
		plans: [planFixture(`entity-${input.externalId}`)],
		result: {
			entity,
			wasInserted: true,
			outcome: { before: null, after: snapshot(entity), operation: "create" as const },
		},
	};
};

it.effect("commits a child set atomically and returns entity then relationship plans", () => {
	const transaction = makeTransaction();
	const entityWrites: string[] = [];
	const reconciliations: Array<{
		command: LifecycleCommand;
		scope: unknown;
		groups: ReadonlyArray<unknown>;
	}> = [];
	const layer = Layer.mergeAll(
		Layer.succeed(Database, transaction.database),
		Layer.succeed(DefinitionRegistry, registry),
		Layer.mock(EntitiesRepository)({}),
		Layer.mock(EntitiesService)({
			persistPlannedProviderUpserts: childEntityUpserts((item) => {
				expect(transaction.inTransaction()).toBe(true);
				entityWrites.push(item.externalId);
			}),
		}),
		Layer.mock(RelationshipsRepository)({
			listRelationshipsForReconciliation: () => Effect.succeed([]),
		}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: (groups, receivedCommand, scope) =>
				Effect.sync(() => {
					expect(transaction.inTransaction()).toBe(true);
					reconciliations.push({ scope, groups, command: receivedCommand });
					return {
						plans: [planFixture("relationships")],
						result: [{ created: 2, updated: 0, deleted: 0, upserted: 2 }],
					};
				}),
		}),
	);

	return Effect.gen(function* () {
		const result = yield* writeChildEntitySet({
			command,
			population,
			providerId,
			definitions,
			scope: "global",
			parentEntityId: rootEntityId,
			parentEntitySchemaSlug: rootSchemaSlug,
			expectedChildEntitySchemaSlug: childSchemaSlug,
			childEntities: [
				{ name: "Second", properties: {}, externalId: "b", entitySchemaSlug: childSchemaSlug },
				{ name: "First", properties: {}, externalId: "a", entitySchemaSlug: childSchemaSlug },
			],
		});
		expect(entityWrites).toEqual(["a", "b"]);
		expect(result.processedChildren.map(({ entity }) => entity.externalId)).toEqual(["b", "a"]);
		expect(result.relationshipResults).toEqual([
			{ created: 2, updated: 0, deleted: 0, upserted: 2 },
		]);
		expect(result.dispatch.map(({ triggerId }) => triggerId)).toEqual([
			"entity-a",
			"entity-b",
			"entities-batch",
			"relationships",
		]);
		expect(reconciliations[0]).toMatchObject({
			scope: { scope: "global" },
			command: {
				causation: command.causation,
				population: {
					...population,
					batch: {
						afterCount: 0,
						isLeader: true,
						beforeCount: 0,
						createdCount: 0,
						deletedCount: 0,
						updatedCount: 0,
					},
				},
			},
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rolls back every child entity when relationship planning fails", () => {
	const persisted: string[] = [];
	const transaction = makeTransaction(() => persisted.splice(0));
	const layer = Layer.mergeAll(
		Layer.succeed(Database, transaction.database),
		Layer.succeed(DefinitionRegistry, registry),
		Layer.mock(EntitiesRepository)({}),
		Layer.mock(EntitiesService)({
			persistPlannedProviderUpserts: childEntityUpserts((item) => {
				persisted.push(item.externalId);
			}),
		}),
		Layer.mock(RelationshipsRepository)({
			listRelationshipsForReconciliation: () => Effect.succeed([]),
		}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: () =>
				Effect.fail(
					new RelationshipBadRequest({ reason: { code: "reconciliation-selector-mismatch" } }),
				),
		}),
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			writeChildEntitySet({
				command,
				population,
				providerId,
				definitions,
				scope: "global",
				parentEntityId: rootEntityId,
				parentEntitySchemaSlug: rootSchemaSlug,
				expectedChildEntitySchemaSlug: childSchemaSlug,
				childEntities: [
					{ name: "First", properties: {}, externalId: "a", entitySchemaSlug: childSchemaSlug },
					{ name: "Second", properties: {}, externalId: "b", entitySchemaSlug: childSchemaSlug },
				],
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		expect(persisted).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("keeps private related entities and reconciliation in one user transaction", () => {
	const transaction = makeTransaction();
	const entityScopes: unknown[] = [];
	let reconciliationScope: unknown;
	let reconciliationCommand: LifecycleCommand | undefined;
	const privateProviderId = SandboxProviderId.make("private-provider");
	const layer = Layer.mergeAll(
		Layer.succeed(Database, transaction.database),
		Layer.succeed(DefinitionRegistry, registry),
		Layer.mock(PluginRuntimeResolver)({
			findProviderAvailableToUserBySlug: () =>
				Effect.sync(() => {
					expect(transaction.inTransaction()).toBe(false);
					return {
						name: "Private",
						createdAt: epoch,
						updatedAt: epoch,
						id: privateProviderId,
						slug: "private.person",
						pluginId: "private-plugin",
						pluginScope: "user" as const,
						providerId: privateProviderId,
						rootEntitySchemaSlug: "person",
						information: { source: "provider" },
					};
				}),
		}),
		Layer.mock(EntitiesRepository)({}),
		Layer.mock(EntitiesService)({
			persistPlannedProviderUpserts: childEntityUpserts((item) => {
				expect(transaction.inTransaction()).toBe(true);
				entityScopes.push({
					scope: item.scope,
					userId: item.scope === "user" ? item.userId : null,
				});
			}),
		}),
		Layer.mock(RelationshipsRepository)({
			listRelationshipsForReconciliation: () => Effect.succeed([]),
		}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: (_groups, receivedCommand, scope) =>
				Effect.sync(() => {
					expect(transaction.inTransaction()).toBe(true);
					reconciliationScope = scope;
					reconciliationCommand = receivedCommand;
					return { plans: [], result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }] };
				}),
		}),
	);

	return Effect.gen(function* () {
		const result = yield* syncRelatedEntityGroup({
			userId,
			command,
			population,
			definitions,
			scope: "user",
			primaryEntityId: rootEntityId,
			primaryEntitySchemaSlug: rootSchemaSlug,
			group: {
				direction: "outgoing",
				synchronization: "additive",
				relationshipSchemaSlug: "credits",
				entities: [
					{
						name: "Person",
						externalId: "person-1",
						providerSlug: "private.person",
						relationshipProperties: { role: "actor" },
					},
				],
			},
		});
		expect(result.result).toEqual([{ created: 1, updated: 0, deleted: 0, upserted: 1 }]);
		expect(entityScopes).toEqual([{ userId, scope: "user" }]);
		expect(reconciliationScope).toEqual({ userId, scope: "user" });
		expect(reconciliationCommand).toMatchObject({
			causation: command.causation,
			population: { rootPreviouslyPopulated: true, scopeEntity: population.scopeEntity },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rolls back a complete related group when reconciliation fails", () => {
	const persisted: string[] = [];
	const transaction = makeTransaction(() => persisted.splice(0));
	const relatedProviderId = SandboxProviderId.make("person-provider");
	const layer = Layer.mergeAll(
		Layer.succeed(Database, transaction.database),
		Layer.succeed(DefinitionRegistry, registry),
		Layer.mock(PluginRuntimeResolver)({}),
		Layer.mock(EntitiesRepository)({
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					providerId: relatedProviderId,
					entitySchemaSlug: EntitySchemaSlug.make("person"),
					detailsScriptId: SandboxScriptId.make("person-details"),
				}),
		}),
		Layer.mock(EntitiesService)({
			persistPlannedProviderUpserts: childEntityUpserts((item) => {
				expect(transaction.inTransaction()).toBe(true);
				persisted.push(item.externalId);
			}),
		}),
		Layer.mock(RelationshipsRepository)({}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: () =>
				Effect.fail(
					new RelationshipBadRequest({ reason: { code: "reconciliation-selector-mismatch" } }),
				),
		}),
	);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(
			syncRelatedEntityGroup({
				command,
				population,
				definitions,
				scope: "global",
				primaryEntityId: rootEntityId,
				primaryEntitySchemaSlug: rootSchemaSlug,
				group: {
					direction: "outgoing",
					synchronization: "authoritative",
					relationshipSchemaSlug: "credits",
					entities: [
						{ name: "First", externalId: "person-1", providerSlug: "person.provider" },
						{ name: "Second", externalId: "person-2", providerSlug: "person.provider" },
					],
				},
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		expect(persisted).toEqual([]);
	}).pipe(Effect.provide(layer));
});

it.effect("uses command causation for deterministic root and final lifecycle writes", () => {
	const transaction = makeTransaction();
	const commands: LifecycleCommand[] = [];
	let postCommitCount = 0;
	const entityRepository = Layer.mock(EntitiesRepository)({
		findEntityByExternalId: () => Effect.succeed(null),
	});
	const entitiesService = Layer.mock(EntitiesService)({
		persistPlannedProviderUpsert: (input) =>
			Effect.sync(() => {
				expect(transaction.inTransaction()).toBe(true);
				commands.push(input.lifecycle);
				const entity = listedEntity({
					name: input.name,
					externalId: input.externalId,
					providerId: input.providerId,
					entitySchemaSlug: input.entitySchemaSlug,
					populatedAt: input.populatedAt?.toISOString() ?? null,
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- provider upsert input carries the plain JSON records these tests supply
					properties: input.properties as Record<string, JsonValue>,
					id: input.lifecycle.population?.scopeEntity.id ?? rootEntityId,
				});
				return {
					plans: [],
					result: {
						entity,
						wasInserted: commands.length === 1,
						outcome: { before: null, after: snapshot(entity), operation: "create" as const },
					},
				} satisfies PlannedEntityWork;
			}),
	});
	const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, "population-root");
	const layer = Layer.mergeAll(
		Layer.succeed(Database, transaction.database),
		Layer.succeed(DefinitionRegistry, registry),
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
		Layer.mock(PluginRuntimeResolver)({
			getEffectiveDefinitions: () => Effect.succeed(definitions),
		}),
		Layer.mock(RelationshipsRepository)({}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: () => Effect.die("unexpected reconciliation"),
		}),
		Layer.mock(EntityImportWorkflowOperations)({
			completeProviderEntityImport: () => Effect.void,
			processSandbox: () =>
				Effect.sync(() => {
					expect(transaction.inTransaction()).toBe(false);
					return {
						logs: [],
						error: null,
						status: "completed" as const,
						value: { name: "Record", properties: {}, childEntities: [], relatedEntityGroups: [] },
					};
				}),
		}),
		entityRepository,
		entitiesService,
		Layer.succeed(LifecycleExecution, {
			after: () => Effect.die("unexpected after"),
			executePolicy: () => Effect.die("unexpected policy"),
			skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
			dispatch: () =>
				Effect.sync(() => {
					expect(transaction.inTransaction()).toBe(false);
					postCommitCount += 1;
					return [];
				}),
		}),
	);
	const payload = {
		command,
		providerId,
		externalId: "record-1",
		mode: "refresh" as const,
		executionId: "population-root",
		entitySchemaSlug: rootSchemaSlug,
		entityScope: { userId, type: "global" as const },
	};

	return Effect.gen(function* () {
		const result = yield* runProviderEntityPopulationWorkflow(payload, payload.executionId);
		expect(result.populatedAt).not.toBeNull();
		expect(commands).toHaveLength(2);
		expect(commands.map(({ causation }) => causation)).toEqual([
			command.causation,
			command.causation,
		]);
		expect(commands.map(({ itemIdentity }) => itemIdentity)).toEqual([
			'["provider-population","root","upsert"]',
			'["provider-population","root","stamp"]',
		]);
		expect(commands[0]?.population).toMatchObject({
			rootPreviouslyPopulated: false,
			scopeEntity: { name: "Record", entitySchemaSlug: rootSchemaSlug },
		});
		expect(commands[1]?.population).toEqual(commands[0]?.population);
		expect(postCommitCount).toBe(2);
	}).pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Effect.provide(layer),
	);
});
