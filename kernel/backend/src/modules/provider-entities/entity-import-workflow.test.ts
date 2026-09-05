import { expect, layer } from "@effect/vitest";
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
import { Context, Effect, Exit, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand, type LifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService } from "#lib/infrastructure/redis";
import { makeRedisService, makeWorkflowActivityEngine } from "#lib/test-utils/effect";
import { planFixture } from "#modules/automations/lifecycle.test-support";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { DefinitionSnapshot } from "#modules/definition-registry/snapshot";
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
const definitionsLayer = Layer.mock(DefinitionRepository)({
	getGlobalSnapshot: Effect.succeed(definitions),
	getUserSnapshot: () => Effect.succeed(definitions),
	findGlobalRelationshipSchema: (slug) =>
		Effect.succeed(definitions.relationshipSchemas[slug] ?? null),
});

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

type PlannedEntityWork = Effect.Success<
	ReturnType<EntitiesService["Service"]["persistPlannedProviderUpsert"]>
>;
type UpsertInput = Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0];
type Reconcile = RelationshipsService["Service"]["persistPlannedReconciliation"];
type Reconciliation = {
	readonly groups: Parameters<Reconcile>[0];
	readonly command: Parameters<Reconcile>[1];
	readonly scope: Parameters<Reconcile>[2];
};

/** A failed transaction discards the rows persisted so far, like a rollback. */
const makeTransaction = <Row>() =>
	Effect.gen(function* () {
		const inTransaction = yield* Ref.make(false);
		const persisted = yield* Ref.make<ReadonlyArray<Row>>([]);
		const database = Layer.mock(DatabaseSession)({
			transaction: (work) =>
				Ref.set(inTransaction, true).pipe(
					Effect.andThen(mapDatabaseErrors(work)),
					Effect.onExit((exit) => (Exit.isFailure(exit) ? Ref.set(persisted, []) : Effect.void)),
					Effect.ensuring(Ref.set(inTransaction, false)),
				),
		});
		const expectTransaction = (active: boolean) =>
			Effect.map(Ref.get(inTransaction), (current) => {
				expect(current).toBe(active);
			});
		const persist = (row: Row) => Ref.update(persisted, (all) => [...all, row]);
		return { persist, database, expectTransaction, persisted: Ref.get(persisted) };
	});

class FakeProviderWrites extends Context.Service<
	FakeProviderWrites,
	{
		readonly persisted: Effect.Effect<ReadonlyArray<UpsertInput>>;
		readonly reconciliations: Effect.Effect<ReadonlyArray<Reconciliation>>;
	}
>()("test/FakeProviderWrites") {}

/** Entity upserts and reconciliation must run inside the transaction and provider lookups outside it. */
const providerWritesLayer = (options: {
	readonly reconciled: Effect.Success<ReturnType<Reconcile>> | "fail";
	readonly relationshipsRepository?: Layer.Layer<RelationshipsRepository>;
	readonly entitiesRepository?: Layer.Layer<EntitiesRepository>;
	readonly privateProvider?: SandboxProviderId;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const transaction = yield* makeTransaction<UpsertInput>();
			const reconciliations = yield* Ref.make<ReadonlyArray<Reconciliation>>([]);
			const { reconciled, privateProvider } = options;
			return Layer.mergeAll(
				transaction.database,
				definitionsLayer,
				Layer.mock(PluginRuntimeResolver)({
					...(privateProvider && {
						findProviderAvailableToUserBySlug: () =>
							transaction
								.expectTransaction(false)
								.pipe(
									Effect.as({
										name: "Private",
										createdAt: epoch,
										updatedAt: epoch,
										id: privateProvider,
										slug: "private.person",
										pluginId: "private-plugin",
										providerId: privateProvider,
										pluginScope: "user" as const,
										rootEntitySchemaSlug: "person",
										information: { source: "provider" },
									}),
								),
					}),
				}),
				options.entitiesRepository ?? Layer.mock(EntitiesRepository)({}),
				Layer.mock(EntitiesService)({
					persistPlannedProviderUpserts: (input) =>
						Effect.forEach(input.items, (item) =>
							transaction
								.expectTransaction(true)
								.pipe(Effect.andThen(transaction.persist(item)), Effect.as(childEntityWork(item))),
						).pipe(
							Effect.map((works) => ({
								results: works.map(({ result }) => result),
								plans: [...works.flatMap(({ plans }) => plans), planFixture("entities-batch")],
							})),
						),
				}),
				options.relationshipsRepository ??
					Layer.mock(RelationshipsRepository)({
						listRelationshipsForReconciliation: () => Effect.succeed([]),
					}),
				Layer.mock(RelationshipsService)({
					persistPlannedReconciliation: (groups, receivedCommand, scope) =>
						reconciled === "fail"
							? Effect.fail(
									new RelationshipBadRequest({
										reason: { code: "reconciliation-selector-mismatch" },
									}),
								)
							: transaction
									.expectTransaction(true)
									.pipe(
										Effect.andThen(
											Ref.update(reconciliations, (all) => [
												...all,
												{ scope, groups, command: receivedCommand },
											]),
										),
										Effect.as(reconciled),
									),
				}),
				Layer.succeed(FakeProviderWrites, {
					persisted: transaction.persisted,
					reconciliations: Ref.get(reconciliations),
				}),
			);
		}),
	);

const persistedExternalIds = Effect.flatMap(FakeProviderWrites, (fake) =>
	Effect.map(fake.persisted, (items) => items.map(({ externalId }) => externalId)),
);

layer(
	providerWritesLayer({
		reconciled: {
			plans: [planFixture("relationships")],
			result: [{ created: 2, updated: 0, deleted: 0, upserted: 2 }],
		},
	}),
)((it) => {
	it.effect("commits a child set atomically and returns entity then relationship plans", () =>
		Effect.gen(function* () {
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
			expect(yield* persistedExternalIds).toEqual(["a", "b"]);
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
			const [reconciliation] = yield* (yield* FakeProviderWrites).reconciliations;
			expect(reconciliation).toMatchObject({
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
		}),
	);
});

layer(providerWritesLayer({ reconciled: "fail" }))((it) => {
	it.effect("rolls back every child entity when relationship planning fails", () =>
		Effect.gen(function* () {
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
			expect(yield* persistedExternalIds).toEqual([]);
		}),
	);
});

layer(
	providerWritesLayer({
		privateProvider: SandboxProviderId.make("private-provider"),
		reconciled: { plans: [], result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }] },
	}),
)((it) => {
	it.effect("keeps private related entities and reconciliation in one user transaction", () =>
		Effect.gen(function* () {
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
			const fake = yield* FakeProviderWrites;
			const entityScopes = (yield* fake.persisted).map((item) => ({
				scope: item.scope,
				userId: item.scope === "user" ? item.userId : null,
			}));
			const [reconciliation] = yield* fake.reconciliations;
			expect(result.result).toEqual([{ created: 1, updated: 0, deleted: 0, upserted: 1 }]);
			expect(entityScopes).toEqual([{ userId, scope: "user" }]);
			expect(reconciliation?.scope).toEqual({ userId, scope: "user" });
			expect(reconciliation?.command).toMatchObject({
				causation: command.causation,
				population: { rootPreviouslyPopulated: true, scopeEntity: population.scopeEntity },
			});
		}),
	);
});

layer(
	providerWritesLayer({
		reconciled: "fail",
		relationshipsRepository: Layer.mock(RelationshipsRepository)({}),
		entitiesRepository: Layer.mock(EntitiesRepository)({
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("person"),
					providerId: SandboxProviderId.make("person-provider"),
					detailsScriptId: SandboxScriptId.make("person-details"),
				}),
		}),
	}),
)((it) => {
	it.effect("rolls back a complete related group when reconciliation fails", () =>
		Effect.gen(function* () {
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
			expect(yield* persistedExternalIds).toEqual([]);
		}),
	);
});

class FakeRootPopulation extends Context.Service<
	FakeRootPopulation,
	{
		readonly commands: Effect.Effect<ReadonlyArray<LifecycleCommand>>;
		readonly postCommitCount: Effect.Effect<number>;
	}
>()("test/FakeRootPopulation") {}

const rootPopulationLayer = Layer.unwrap(
	Effect.gen(function* () {
		const transaction = yield* makeTransaction<LifecycleCommand>();
		const postCommitCount = yield* Ref.make(0);
		const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, "population-root");
		return Layer.mergeAll(
			transaction.database,
			definitionsLayer,
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
			Layer.mock(PluginRuntimeResolver)({}),
			Layer.mock(RelationshipsRepository)({}),
			Layer.mock(RelationshipsService)({
				persistPlannedReconciliation: () => Effect.die("unexpected reconciliation"),
			}),
			Layer.mock(EntityImportWorkflowOperations)({
				completeProviderEntityImport: () => Effect.void,
				processProviderResolve: () => Effect.die("unexpected provider resolve"),
				processSandbox: () =>
					transaction
						.expectTransaction(false)
						.pipe(
							Effect.as({
								logs: [],
								error: null,
								status: "completed" as const,
								value: {
									name: "Record",
									properties: {},
									childEntities: [],
									relatedEntityGroups: [],
								},
							}),
						),
			}),
			Layer.mock(EntitiesRepository)({ findEntityByExternalId: () => Effect.succeed(null) }),
			Layer.mock(EntitiesService)({
				persistPlannedProviderUpsert: (input) =>
					Effect.gen(function* () {
						yield* transaction.expectTransaction(true);
						yield* transaction.persist(input.lifecycle);
						const commands = yield* transaction.persisted;
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
			}),
			Layer.succeed(LifecycleExecution, {
				after: () => Effect.die("unexpected after"),
				executePolicy: () => Effect.die("unexpected policy"),
				skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
				dispatch: () =>
					transaction
						.expectTransaction(false)
						.pipe(Effect.andThen(Ref.update(postCommitCount, (count) => count + 1)), Effect.as([])),
			}),
			Layer.succeed(FakeRootPopulation, {
				commands: transaction.persisted,
				postCommitCount: Ref.get(postCommitCount),
			}),
		);
	}),
);

layer(rootPopulationLayer)((it) => {
	it.effect("uses command causation for deterministic root and final lifecycle writes", () => {
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
			const fake = yield* FakeRootPopulation;
			const commands = yield* fake.commands;
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
			expect(yield* fake.postCommitCount).toBe(2);
		});
	});
});
