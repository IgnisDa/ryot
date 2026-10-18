import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionOwner,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, DateTime, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { planFixture } from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecyclePlan,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import type { EntityRelationshipDefinitions } from "#modules/definitions/snapshot";
import { EnrichmentRequestsRepository } from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
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
import {
	makeMemoizingWorkflowEngine,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#testing/effect";

import { RecordedLogAnnotations, recordLogAnnotationsLayer } from "./log-annotations.test-support";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	type ProviderEntityPopulationAttemptPayload,
	ProviderEntityPopulationAttemptWorkflow,
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationAttemptWorkflow,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";

const now = IsoUtcString.make("2026-09-17T00:00:00.000Z");
const userId = UserId.make("population-user");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const childSchemaSlug = EntitySchemaSlug.make("part");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("record-part");
const relatedSchemaSlug = EntitySchemaSlug.make("person");

const command = {
	...rootLifecycleCommand({
		occurredAt: now,
		lane: "background",
		source: "provider-refresh",
		itemIdentity: "population",
		initiator: { id: userId, kind: "user" },
		accountGeneration: { userId, token: "test-account-generation" },
		executionId: AutomationExecutionId.make("population-execution"),
	}),
	writeContext: null,
};

const entityDefinition = (slug: string) => ({ slug, pluginId: null });

const definitions = {
	entitySchemas: {
		[rootSchemaSlug]: entityDefinition(rootSchemaSlug),
		[childSchemaSlug]: entityDefinition(childSchemaSlug),
		[relatedSchemaSlug]: entityDefinition(relatedSchemaSlug),
	},
	relationshipSchemas: {
		credits: {
			pluginId: null,
			slug: "credits",
			name: "Credits",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: relatedSchemaSlug,
		},
		[relationshipSchemaSlug]: {
			name: "Parts",
			pluginId: null,
			slug: relationshipSchemaSlug,
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: childSchemaSlug,
		},
	},
} satisfies EntityRelationshipDefinitions;

const listedEntity = (
	input: Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0],
): ListedEntity => ({
	createdAt: now,
	updatedAt: now,
	properties: {},
	name: "Record",
	populatedAt: now,
	providerId: input.providerId,
	externalId: input.externalId,
	id: EntityId.make(input.externalId),
	entitySchemaSlug: input.entitySchema.slug,
	entitySchemaPluginId: definitionOwnerPluginId(input.entitySchema.owner),
});

const payloadFields = {
	level: "full" as const,
	externalId: "record-1",
	mode: "refresh" as const,
	entitySchemaSlug: rootSchemaSlug,
	executionId: "population-workflow",
	entityScope: { userId, type: "global" as const },
};

const sandboxResult = {
	logs: [],
	error: null,
	status: "completed" as const,
	value: {
		name: "Record",
		properties: {},
		childEntities: [
			{ name: "Part", properties: {}, externalId: "part-1", entitySchemaSlug: childSchemaSlug },
		],
		relatedEntityGroups: [
			{
				direction: "outgoing" as const,
				relationshipSchemaSlug: "credits",
				synchronization: "additive" as const,
				entities: [{ name: "Person", externalId: "person-1", providerSlug: "person.provider" }],
			},
		],
	},
};

class FakePopulationWrites extends Context.Service<
	FakePopulationWrites,
	{
		readonly recorded: Effect.Effect<ReadonlyArray<string>>;
		readonly payload: ProviderEntityPopulationAttemptPayload;
	}
>()("test/FakePopulationWrites") {}

type DispatchedPlans = Parameters<LifecycleExecution["Service"]["dispatch"]>[0];

const populationLayer = (options: {
	readonly rootPlans?: ReadonlyArray<LifecyclePlan>;
	readonly dispatch: (plans: DispatchedPlans) => {
		readonly entry: string;
		readonly warnings: Effect.Success<ReturnType<LifecycleExecution["Service"]["dispatch"]>>;
	};
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({
						id: userId,
						name: "Population",
						email: "population@example.test",
						accountGeneration: "test-account-generation",
					}),
			);
			const source = revisionPackage("population", "v1", rootSchemaSlug);
			const details = source.scripts.find(
				({ metadata }) => metadata.kind === "provider" && metadata.providerOperation === "details",
			);
			assert(details?.metadata.kind === "provider");
			const relatedScript = {
				...details,
				slug: "person.details",
				contentHash: "person-details",
				entry: "backend/person-details.sandbox.ts",
				metadata: { ...details.metadata, slug: "person.details", providerSlug: "person.provider" },
			};
			const installed = yield* installRevisionPackage({
				...source,
				scripts: [...source.scripts, relatedScript],
				manifest: {
					...source.manifest,
					scripts: [
						...source.manifest.scripts,
						{ ...relatedScript.metadata, entry: relatedScript.entry },
					],
					relationshipSchemas: Object.values(definitions.relationshipSchemas).map(
						({ pluginId: _owner, ...definition }) => definition,
					),
					entitySchemas: Object.values(definitions.entitySchemas).map(({ slug }) => ({
						slug,
						name: slug,
						icon: "box",
						eventSchemas: [],
						propertiesSchema: { fields: {} },
					})),
					providers: [
						...source.manifest.providers,
						{
							name: "Person",
							slug: "person.provider",
							information: { source: "fixture" },
							rootEntitySchemaSlug: relatedSchemaSlug,
						},
					],
				},
			});
			yield* (yield* PluginInstallationRepository).upsertState({
				userId,
				config: {},
				sortOrder: 0,
				health: "ready",
				isHidden: false,
				pluginId: installed.pluginId,
			});
			const runtime = yield* PluginRuntimeResolver;
			const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
				slug: "population-provider",
				owner: definitionOwner(installed.pluginId),
			});
			assert(provider);
			const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
			const subject = {
				userId,
				type: "user" as const,
				accountGeneration: { userId, token: "test-account-generation" },
			};
			const pin = yield* (yield* SandboxRepository.make).getScriptPin(
				script.id,
				undefined,
				subject,
			);
			assert(pin?.pluginRevision);
			const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
			const payload: ProviderEntityPopulationAttemptPayload = {
				...payloadFields,
				providerId: provider.id,
				requestId: payloadFields.executionId,
				pluginId: PluginId.make(installed.pluginId),
				command: { ...command, writeContext: principal },
			};
			const recorded = yield* Ref.make<ReadonlyArray<string>>([]);
			const record = (entry: string) => Ref.update(recorded, (all) => [...all, entry]);
			const upsertItem = (
				input: Parameters<EntitiesService["Service"]["persistPlannedProviderUpsert"]>[0],
			) => {
				const kind = input.populatedAt === null ? "upsert" : "write";
				const label = input.externalId === payload.externalId ? `root-${kind}` : "child-entity";
				const entity = listedEntity(input);
				return record(label).pipe(
					Effect.as({
						result: { entity },
						dispatch:
							label === "root-upsert"
								? (options.rootPlans ?? [planFixture("root-upsert")]).map(toLifecycleDispatchPlan)
								: [toLifecycleDispatchPlan(planFixture(label))],
					}),
				);
			};
			return Layer.mergeAll(
				Layer.mock(EnrichmentRequests)({ attachEntity: () => Effect.void }),
				Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
				Layer.succeed(PluginRuntimeResolver, runtime),
				DomainWriteChecksLive,
				Layer.mock(EntitiesRepository)({
					lockMutationKeys: () => Effect.void,
					invalidateRelatedPopulated: () => Effect.void,
					stampChildRelatedPopulated: () => Effect.void,
					findPopulationTarget: () => Effect.succeed(null),
					stampRelatedPopulated: () => record("related-stamp"),
					holdsRelatedPopulationGeneration: () => Effect.succeed(true),
				}),
				Layer.mock(EntitiesService)({
					persistPlannedProviderUpsert: upsertItem,
					persistPlannedProviderUpserts: (input) =>
						Effect.forEach(input.items, upsertItem).pipe(
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
					claimRelationshipSyncGeneration: () => Effect.void,
					holdsRelationshipSyncGeneration: () => Effect.succeed(true),
					listRelationshipsForReconciliation: () => Effect.succeed([]),
				}),
				Layer.mock(RelationshipsService)({
					persistPlannedReconciliation: (_groups, _command, _scope) =>
						record("relationships").pipe(
							Effect.as({
								result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }],
								dispatch: [toLifecycleDispatchPlan(planFixture("relationships"))],
							}),
						),
				}),
				Layer.mock(EntityImportWorkflowOperations)({
					completeProviderEntityImport: () => Effect.void,
					processProviderResolve: () => Effect.die("unexpected provider resolve"),
					processSandbox: (_payload, _executionId, level) =>
						record(`details:${level}`).pipe(Effect.as(sandboxResult)),
				}),
				Layer.succeed(LifecycleExecution, {
					after: () => Effect.die("unexpected after"),
					executePolicy: () => Effect.die("unexpected policy"),
					skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
					executeBatchPolicy: () => Effect.die("Unexpected batch policy"),
					dispatch: (plans) => {
						const { entry, warnings } = options.dispatch(plans);
						return record(entry).pipe(Effect.as(warnings));
					},
				}),
				Layer.succeed(FakePopulationWrites, { payload, recorded: Ref.get(recorded) }),
			);
		}),
	).pipe(Layer.provideMerge(revisionDatabaseLayer));

const blocked = {
	omittedHooks: [],
	hasRequiredHooks: true,
	code: "automation-limit-reached" as const,
};

layer(
	Layer.merge(
		recordLogAnnotationsLayer("automation warnings"),
		populationLayer({
			dispatch: (plans) => ({
				entry: `dispatch:${plans.map(({ triggerId }) => triggerId).join(",")}`,
				warnings: plans.some(({ triggerId }) => triggerId === "root-upsert")
					? [{ ...blocked, triggerId: AutomationTriggerId.make("root-upsert") }]
					: [],
			}),
		}),
	),
)((test) => {
	test.effect("dispatches each population write between activities and logs blocked hooks", () =>
		Effect.gen(function* () {
			const payload = (yield* FakePopulationWrites).payload;
			const instance = WorkflowInstance.initial(
				ProviderEntityPopulationAttemptWorkflow,
				payload.executionId,
			);

			return yield* runProviderEntityPopulationAttemptWorkflow(payload, payload.executionId).pipe(
				Effect.tap(() =>
					Effect.gen(function* () {
						expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
							"details:full",
							"root-upsert",
							"dispatch:root-upsert",
							"child-entity",
							"relationships",
							"dispatch:child-entity,entities-batch,relationships",
							"root-write",
							"dispatch:root-write",
							"child-entity",
							"relationships",
							"dispatch:child-entity,entities-batch,relationships",
							"related-stamp",
						]);
						const warningLogs = yield* (yield* RecordedLogAnnotations).annotations;
						expect(warningLogs.map((annotations) => annotations["phase"])).toEqual(["root-upsert"]);
					}),
				),
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				Effect.asVoid,
			);
		}),
	);
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect("replays the population body without re-running committed write activities", () =>
		Effect.gen(function* () {
			const payload = (yield* FakePopulationWrites).payload;
			const activityRuns: string[] = [];
			const instance = WorkflowInstance.initial(
				ProviderEntityPopulationAttemptWorkflow,
				payload.executionId,
			);
			const engine = makeMemoizingWorkflowEngine(instance, activityRuns);
			const run = runProviderEntityPopulationAttemptWorkflow(payload, payload.executionId).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, engine),
			);

			const first = yield* run;
			const replayed = yield* run;
			expect(replayed).toEqual(first);
			expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
				"details:full",
				"root-upsert",
				"dispatch",
				"child-entity",
				"relationships",
				"dispatch",
				"root-write",
				"dispatch",
				"child-entity",
				"relationships",
				"dispatch",
				"related-stamp",
				"details:full",
				"dispatch",
				"dispatch",
				"dispatch",
				"dispatch",
			]);
			expect(activityRuns.filter((name) => name === "upsert-root-entity")).toHaveLength(1);
			expect(activityRuns.filter((name) => name === "stamp-root-populated-at")).toHaveLength(1);
		}),
	);
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect("rejects a root schema that does not belong to its exact provider", () =>
		Effect.gen(function* () {
			const payload = (yield* FakePopulationWrites).payload;
			const executionId = "population-missing-root-schema";
			const instance = WorkflowInstance.initial(
				ProviderEntityPopulationAttemptWorkflow,
				executionId,
			);
			return yield* Effect.gen(function* () {
				const error = yield* Effect.flip(
					runProviderEntityPopulationAttemptWorkflow(
						{ ...payload, executionId, entitySchemaSlug: childSchemaSlug },
						executionId,
					),
				);
				expect(error.message).toBe("Provider root schema does not match its exact owner");
			}).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
			);
		}),
	);
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect(
		"persists the root and children at base level, ignores returned related groups, and stamps only populated_at",
		() =>
			Effect.gen(function* () {
				const payload = { ...(yield* FakePopulationWrites).payload, level: "base" as const };
				const instance = WorkflowInstance.initial(
					ProviderEntityPopulationAttemptWorkflow,
					payload.executionId,
				);
				yield* runProviderEntityPopulationAttemptWorkflow(payload, payload.executionId).pipe(
					Effect.provideService(WorkflowInstance, instance),
					Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				);
				expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
					"details:base",
					"root-upsert",
					"dispatch",
					"child-entity",
					"relationships",
					"dispatch",
					"root-write",
					"dispatch",
				]);
			}),
	);
});

const existingRequestFixture = Effect.fnUntraced(function* (
	populatedAt: ListedEntity["populatedAt"],
) {
	const original = (yield* FakePopulationWrites).payload;
	const executionId = `${original.executionId}-${populatedAt === null ? "stub" : "ready"}`;
	const payload: ProviderEntityPopulationAttemptPayload = {
		...original,
		executionId,
		level: "base",
		mode: "ensure",
		requestId: executionId,
		externalId: executionId,
	};
	const stub = {
		populatedAt,
		properties: {},
		createdAt: now,
		updatedAt: now,
		name: "Existing",
		externalId: payload.externalId,
		providerId: payload.providerId,
		entitySchemaPluginId: payload.pluginId,
		id: EntityId.make(`${executionId}-entity`),
		entitySchemaSlug: payload.entitySchemaSlug,
	} satisfies ListedEntity;
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.entity)
			.values({
				id: stub.id,
				name: stub.name,
				externalId: stub.externalId,
				providerId: stub.providerId,
				entitySchemaSlug: stub.entitySchemaSlug,
				entitySchemaPluginId: stub.entitySchemaPluginId,
				populatedAt:
					populatedAt === null ? null : DateTime.toDateUtc(DateTime.makeUnsafe(populatedAt)),
			}),
	);
	const requestsRepository = yield* EnrichmentRequestsRepository.make;
	const requests = yield* EnrichmentRequests.make.pipe(
		Effect.provideService(EnrichmentRequestsRepository, requestsRepository),
	);
	yield* requests.ensure({
		payload,
		level: "base",
		entityId: null,
		language: null,
		id: executionId,
		scopeUserId: null,
		operation: "population",
		pluginId: payload.pluginId,
		externalId: payload.externalId,
		providerId: payload.providerId,
		entitySchemaSlug: payload.entitySchemaSlug,
		requester: payload.command.accountGeneration,
		workflowName: ProviderEntityPopulationWorkflow._tag,
	});
	const repository = yield* EntitiesRepository;
	return {
		stub,
		payload,
		requests,
		repository: {
			...repository,
			findPopulationTarget: () =>
				Effect.succeed({ entity: stub, relatedPopulated: populatedAt !== null }),
		},
	};
});

layer(populationLayer({ dispatch: () => ({ warnings: [], entry: "dispatch" }) }))((test) => {
	test.effect(
		"attaches an existing stub before details fail so exact-entity retry lookup finds the request",
		() =>
			Effect.gen(function* () {
				const fixture = yield* existingRequestFixture(null);
				const operations = yield* EntityImportWorkflowOperations;
				const failure = new SandboxRunError({ kind: "script-failure", message: "Details failed" });
				const runAttempt = (payload: ProviderEntityPopulationAttemptPayload, executionId: string) =>
					runProviderEntityPopulationAttemptWorkflow(payload, executionId).pipe(
						Effect.provideService(EnrichmentRequests, fixture.requests),
						Effect.provideService(EntitiesRepository, fixture.repository),
						Effect.provideService(EntityImportWorkflowOperations, {
							...operations,
							processSandbox: () =>
								fixture.requests.get(fixture.payload.requestId).pipe(
									Effect.orDie,
									Effect.tap((row) =>
										Effect.sync(() => expect(row?.entityId).toBe(fixture.stub.id)),
									),
									Effect.andThen(Effect.fail(failure)),
								),
						}),
					);
				const context =
					yield* Effect.context<
						Exclude<
							Effect.Services<ReturnType<typeof runAttempt>>,
							WorkflowEngine | WorkflowInstance
						>
					>();
				const instance = WorkflowInstance.initial(
					ProviderEntityPopulationWorkflow,
					fixture.payload.executionId,
				);
				const engine = makeWorkflowActivityEngine(instance, {
					execute: (_workflow, options) =>
						Effect.gen(function* () {
							const payload = yield* Schema.decodeUnknownEffect(
								ProviderEntityPopulationAttemptWorkflow.payloadSchema,
							)(options.payload).pipe(Effect.orDie);
							const child = WorkflowInstance.initial(
								ProviderEntityPopulationAttemptWorkflow,
								payload.executionId,
							);
							return yield* runAttempt(payload, payload.executionId).pipe(
								Effect.provideService(WorkflowInstance, child),
								Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(child)),
								Effect.provide(context),
							);
						}),
				});
				const error = yield* runProviderEntityPopulationWorkflow(
					fixture.payload,
					fixture.payload.executionId,
				).pipe(
					Effect.provideService(EnrichmentRequests, fixture.requests),
					Effect.provideService(WorkflowInstance, instance),
					Effect.provideService(WorkflowEngine, engine),
					Effect.flip,
				);
				expect(error.message).toBe(failure.message);
				const requester = fixture.payload.command.accountGeneration;
				assert(requester);
				expect(
					yield* fixture.requests.latest({
						requester,
						operation: "population",
						entityId: fixture.stub.id,
					}),
				).toMatchObject({
					state: "failed",
					entityId: fixture.stub.id,
					id: fixture.payload.requestId,
					failureKind: "script-failure",
				});
			}),
	);

	test.effect("attaches an existing entity before returning its cached population", () =>
		Effect.gen(function* () {
			const fixture = yield* existingRequestFixture(now);
			const instance = WorkflowInstance.initial(
				ProviderEntityPopulationAttemptWorkflow,
				fixture.payload.executionId,
			);
			expect(
				yield* runProviderEntityPopulationAttemptWorkflow(
					fixture.payload,
					fixture.payload.executionId,
				).pipe(
					Effect.provideService(EnrichmentRequests, fixture.requests),
					Effect.provideService(EntitiesRepository, fixture.repository),
					Effect.provideService(WorkflowInstance, instance),
					Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				),
			).toEqual(fixture.stub);
			expect(yield* fixture.requests.get(fixture.payload.requestId)).toMatchObject({
				entityId: fixture.stub.id,
			});
			expect(yield* (yield* FakePopulationWrites).recorded).toEqual([]);
		}),
	);
});
