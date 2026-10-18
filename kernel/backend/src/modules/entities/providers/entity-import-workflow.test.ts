import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionKey,
	definitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import { RelationshipBadRequest } from "@ryot-app/contract/modules/relationships/schemas";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Exit, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { planFixture } from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { toLifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { DefinitionRepository } from "#modules/definitions/repository";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import {
	type DomainLifecycleCommand,
	DomainWriteChecksLive,
} from "#modules/entities/write-context";
import { mutationAdmissionTestLayer } from "#modules/mutations/admission.test-support";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import * as tables from "#schema/tables/combined";
import { makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { writeChildEntitySet } from "./population";
import {
	type ProviderEntityPopulationAttemptPayload,
	ProviderEntityPopulationAttemptWorkflow,
	runProviderEntityPopulationAttemptWorkflow,
} from "./provider-entity-population-workflow";

const now = IsoUtcString.make("2026-09-16T00:00:00.000Z");
const userId = UserId.make("user-1");
const providerId = SandboxProviderId.make("provider-1");
const pluginId = PluginId.make("private-plugin");
const owner = definitionOwner(pluginId);
const rootEntityId = EntityId.make("root-1");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const childSchemaSlug = EntitySchemaSlug.make("part");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("record-part");

const command = {
	...rootLifecycleCommand({
		occurredAt: now,
		lane: "background",
		source: "provider-refresh",
		itemIdentity: "provider-population",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make("provider-population"),
		accountGeneration: { userId, token: "test-account-generation" },
		providerExecutionId: AutomationExecutionId.make("provider-workflow"),
	}),
	writeContext: null,
};

const entityDefinition = (slug: string) => ({ slug, pluginId });

const definitions = {
	entitySchemas: {
		[definitionKey("entity", owner, "person")]: entityDefinition("person"),
		[definitionKey("entity", owner, rootSchemaSlug)]: entityDefinition(rootSchemaSlug),
		[definitionKey("entity", owner, childSchemaSlug)]: entityDefinition(childSchemaSlug),
	},
	relationshipSchemas: {
		[definitionKey("relationship", owner, "credits")]: {
			slug: "credits",
			name: "Credits",
			pluginId: "private-plugin",
			propertiesSchema: { fields: {} },
			targetEntitySchemaSlug: "person",
			sourceEntitySchemaSlug: rootSchemaSlug,
		},
		[definitionKey("relationship", owner, relationshipSchemaSlug)]: {
			pluginId,
			name: "Parts",
			slug: relationshipSchemaSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: childSchemaSlug,
		},
	},
} satisfies EntityRelationshipDefinitions;
const definitionsWithoutChildSchema = {
	...definitions,
	entitySchemas: {
		[definitionKey("entity", owner, "person")]: entityDefinition("person"),
		[definitionKey("entity", owner, rootSchemaSlug)]: entityDefinition(rootSchemaSlug),
	},
} satisfies EntityRelationshipDefinitions;
const definitionsWithoutChildRelationship = {
	...definitions,
	relationshipSchemas: Object.fromEntries(
		Object.entries(definitions.relationshipSchemas).filter(
			([, definition]) => definition.slug === "credits",
		),
	),
} satisfies EntityRelationshipDefinitions;
const definitionMethods = {
	getGlobalEntityRelationshipDefinitions: Effect.succeed(definitions),
	getUserEntityRelationshipDefinitions: () => Effect.succeed(definitions),
	findGlobalRelationshipSchema: (reference) =>
		Effect.succeed(
			definitions.relationshipSchemas[
				definitionKey("relationship", reference.owner, reference.slug)
			] ?? null,
		),
} satisfies Partial<DefinitionRepository["Service"]>;
const definitionsLayer = Layer.mock(DefinitionRepository)(definitionMethods);

const population = {
	rootPreviouslyPopulated: true,
	parentEntity: {
		name: "Record",
		properties: {},
		entitySchemaPluginId: pluginId,
		entitySchemaSlug: rootSchemaSlug,
	},
	scopeEntity: {
		name: "Record",
		id: rootEntityId,
		entitySchemaPluginId: pluginId,
		entitySchemaSlug: rootSchemaSlug,
	},
} satisfies AutomationPopulationContext;

const listedEntity = (input: {
	id: EntityId;
	name: string;
	externalId: string;
	properties?: Record<string, JsonValue>;
	populatedAt?: string | null;
	entitySchemaSlug: EntitySchemaSlug;
	providerId?: SandboxProviderId;
	entitySchemaPluginId?: ListedEntity["entitySchemaPluginId"];
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
		entitySchemaPluginId:
			input.entitySchemaPluginId === undefined ? pluginId : input.entitySchemaPluginId,
	}) satisfies ListedEntity;

const childEntityWork = (
	input: Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0],
): PlannedEntityWork => {
	const entity = listedEntity({
		name: input.name,
		externalId: input.externalId,
		providerId: input.providerId,
		entitySchemaSlug: input.entitySchema.slug,
		id: EntityId.make(`entity-${input.externalId}`),
		populatedAt: input.populatedAt?.toISOString() ?? null,
		entitySchemaPluginId: definitionOwnerPluginId(input.entitySchema.owner),
		properties: Schema.decodeUnknownSync(Schema.Record(Schema.String, JsonValue))(input.properties),
	});
	return {
		result: { entity },
		dispatch: [toLifecycleDispatchPlan(planFixture(`entity-${input.externalId}`))],
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

const makeTransaction = <Row>(provided?: DatabaseSession["Service"]) =>
	Effect.gen(function* () {
		const session =
			provided ?? Context.get(yield* Layer.build(mutationAdmissionTestLayer), DatabaseSession);
		const inTransaction = yield* Ref.make(false);
		const persisted = yield* Ref.make<ReadonlyArray<Row>>([]);
		const database = Layer.succeed(DatabaseSession, {
			...session,
			transaction: (work) =>
				Ref.set(inTransaction, true).pipe(
					Effect.andThen(session.transaction(work)),
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
		readonly stampedChildren: Effect.Effect<ReadonlyArray<ReadonlyArray<EntityId>>>;
	}
>()("test/FakeProviderWrites") {}

const providerWritesLayer = (options: {
	readonly reconciled: Effect.Success<ReturnType<Reconcile>> | "fail";
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const transaction = yield* makeTransaction<UpsertInput>();
			const reconciliations = yield* Ref.make<ReadonlyArray<Reconciliation>>([]);
			const stampedChildren = yield* Ref.make<ReadonlyArray<ReadonlyArray<EntityId>>>([]);
			const { reconciled } = options;
			return Layer.mergeAll(
				transaction.database,
				definitionsLayer,
				Layer.mock(EntitiesRepository)({
					stampChildRelatedPopulated: (ids) =>
						transaction
							.expectTransaction(true)
							.pipe(Effect.andThen(Ref.update(stampedChildren, (all) => [...all, ids]))),
				}),
				Layer.mock(EntitiesService)({
					persistPlannedProviderUpserts: (input) =>
						Effect.forEach(input.items, (item) =>
							transaction
								.expectTransaction(true)
								.pipe(Effect.andThen(transaction.persist(item)), Effect.as(childEntityWork(item))),
						).pipe(
							Effect.map((works) => ({
								results: works.map(({ result }) => result),
								dispatch: [
									...works.flatMap(({ dispatch }) => dispatch),
									toLifecycleDispatchPlan(planFixture("entities-batch")),
								],
							})),
						),
				}),
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
					stampedChildren: Ref.get(stampedChildren),
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
			result: [{ created: 2, updated: 0, deleted: 0, upserted: 2 }],
			dispatch: [toLifecycleDispatchPlan(planFixture("relationships"))],
		},
	}),
)((it) => {
	it.effect(
		"commits children and stamps in provider order with entity then relationship plans",
		() =>
			Effect.gen(function* () {
				const result = yield* writeChildEntitySet({
					command,
					pluginId,
					population,
					providerId,
					definitions,
					scope: "global",
					parentEntityId: rootEntityId,
					parentEntitySchemaSlug: rootSchemaSlug,
					expectedChildEntitySchemaSlug: childSchemaSlug,
					childEntities: [
						{ name: "Second", properties: {}, externalId: "b", entitySchemaSlug: childSchemaSlug },
						{ name: "First", properties: {}, externalId: "A", entitySchemaSlug: childSchemaSlug },
					],
				});
				expect(yield* persistedExternalIds).toEqual(["b", "A"]);
				expect(result.processedChildren.map(({ entity }) => entity.externalId)).toEqual(["b", "A"]);
				expect(yield* (yield* FakeProviderWrites).stampedChildren).toEqual([
					["entity-b", "entity-A"],
				]);
				expect(result.relationshipResults).toEqual([
					{ created: 2, updated: 0, deleted: 0, upserted: 2 },
				]);
				expect(result.dispatch.map(({ triggerId }) => triggerId)).toEqual([
					"entity-b",
					"entity-A",
					"entities-batch",
					"relationships",
				]);
				const [reconciliation] = yield* (yield* FakeProviderWrites).reconciliations;
				expect(
					reconciliation?.groups[0]?.relationships.map(({ targetEntityId }) => targetEntityId),
				).toEqual(["entity-b", "entity-A"]);
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
					pluginId,
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

layer(providerWritesLayer({ reconciled: { result: [], dispatch: [] } }))((it) => {
	it.effect("rejects a child entity when its schema is missing from the population catalog", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				writeChildEntitySet({
					command,
					pluginId,
					population,
					providerId,
					scope: "global",
					childEntities: [],
					parentEntityId: rootEntityId,
					parentEntitySchemaSlug: rootSchemaSlug,
					definitions: definitionsWithoutChildSchema,
					expectedChildEntitySchemaSlug: childSchemaSlug,
				}),
			);
			expect(error.message).toBe("Child entity schema not found: part");
		}),
	);

	it.effect(
		"rejects a child entity when its relationship schema is missing from the population catalog",
		() =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					writeChildEntitySet({
						command,
						pluginId,
						population,
						providerId,
						scope: "global",
						childEntities: [],
						parentEntityId: rootEntityId,
						parentEntitySchemaSlug: rootSchemaSlug,
						expectedChildEntitySchemaSlug: childSchemaSlug,
						definitions: definitionsWithoutChildRelationship,
					}),
				);
				expect(error.message).toBe("Child relationship schema not found: record -> part");
			}),
	);
});

class FakeRootPopulation extends Context.Service<
	FakeRootPopulation,
	{
		readonly commands: Effect.Effect<ReadonlyArray<DomainLifecycleCommand>>;
		readonly postCommitCount: Effect.Effect<number>;
		readonly payload: ProviderEntityPopulationAttemptPayload;
	}
>()("test/FakeRootPopulation") {}

const rootPopulationLayer = Layer.unwrap(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({
					id: userId,
					name: "User",
					email: "root-population@example.test",
					accountGeneration: "test-account-generation",
				}),
		);
		const installed = yield* installRevisionPackage(
			revisionPackage("root-population", "v1", rootSchemaSlug),
			userId,
		);
		const runtime = yield* PluginRuntimeResolver;
		const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
			slug: "root-population-provider",
			owner: definitionOwner(installed.pluginId),
		});
		if (!provider) {
			return yield* Effect.die("Missing provider fixture");
		}
		const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
		const subject = {
			userId,
			type: "user" as const,
			accountGeneration: { userId, token: "test-account-generation" },
		};
		const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
		if (!pin?.pluginRevision) {
			return yield* Effect.die("Missing provider fixture pin");
		}
		const { readPinnedRows } = yield* DefinitionRepository.make;
		const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
		const payload: ProviderEntityPopulationAttemptPayload = {
			level: "full",
			mode: "refresh",
			externalId: "record-1",
			providerId: provider.id,
			requestId: "population-root",
			executionId: "population-root",
			entitySchemaSlug: rootSchemaSlug,
			entityScope: { userId, type: "user" },
			pluginId: PluginId.make(installed.pluginId),
			command: { ...command, writeContext: principal },
		};
		const transaction = yield* makeTransaction<DomainLifecycleCommand>(session);
		const postCommitCount = yield* Ref.make(0);
		const instance = WorkflowInstance.initial(
			ProviderEntityPopulationAttemptWorkflow,
			"population-root",
		);
		return Layer.mergeAll(
			Layer.mock(EnrichmentRequests)({ attachEntity: () => Effect.void }),
			transaction.database,
			DomainWriteChecksLive.pipe(Layer.provide(transaction.database)),
			Layer.mock(DefinitionRepository)({ ...definitionMethods, readPinnedRows }),
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
			Layer.mock(EntitiesRepository)({
				lockMutationKeys: () => Effect.void,
				stampRelatedPopulated: () => Effect.void,
				invalidateRelatedPopulated: () => Effect.void,
				stampChildRelatedPopulated: () => Effect.void,
				findPopulationTarget: () => Effect.succeed(null),
				holdsRelatedPopulationGeneration: () => Effect.succeed(true),
			}),
			Layer.mock(EntitiesService)({
				persistPlannedProviderUpsert: (input) =>
					Effect.gen(function* () {
						yield* transaction.expectTransaction(true);
						yield* transaction.persist(input.lifecycle);
						const scopeEntity = input.lifecycle.population?.scopeEntity;
						assert(scopeEntity);
						const entity = listedEntity({
							name: input.name,
							id: scopeEntity.id,
							externalId: input.externalId,
							providerId: input.providerId,
							entitySchemaSlug: input.entitySchema.slug,
							populatedAt: input.populatedAt?.toISOString() ?? null,
							entitySchemaPluginId: definitionOwnerPluginId(input.entitySchema.owner),
							properties: yield* Schema.decodeUnknownEffect(
								Schema.Record(Schema.String, JsonValue),
							)(input.properties).pipe(
								Effect.mapError(
									() => new DbError({ message: "Invalid provider entity fixture properties" }),
								),
							),
						});
						return { dispatch: [], result: { entity } } satisfies PlannedEntityWork;
					}),
			}),
			Layer.succeed(LifecycleExecution, {
				after: () => Effect.die("unexpected after"),
				executePolicy: () => Effect.die("unexpected policy"),
				skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
				executeBatchPolicy: () => Effect.die("Unexpected batch policy"),
				dispatch: () =>
					transaction
						.expectTransaction(false)
						.pipe(Effect.andThen(Ref.update(postCommitCount, (count) => count + 1)), Effect.as([])),
			}),
			Layer.succeed(FakeRootPopulation, {
				payload,
				commands: transaction.persisted,
				postCommitCount: Ref.get(postCommitCount),
			}),
		);
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

layer(rootPopulationLayer)((it) => {
	it.effect("uses command causation for deterministic root and final lifecycle writes", () => {
		return Effect.gen(function* () {
			const fake = yield* FakeRootPopulation;
			const payload = fake.payload;
			const result = yield* runProviderEntityPopulationAttemptWorkflow(
				payload,
				payload.executionId,
			);
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
