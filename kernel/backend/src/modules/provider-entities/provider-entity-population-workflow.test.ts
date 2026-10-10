import { assert, expect, layer } from "@effect/vitest";
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
	RelationshipSchemaSlug,
	UserId,
	PluginId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { ScriptExecutionPrincipal } from "@ryot-app/sandbox/protocol/principal";
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { toLifecycleDispatchPlan, type LifecyclePlan } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService } from "#lib/infrastructure/redis";
import {
	makeMemoizingWorkflowEngine,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { planFixture } from "#modules/automations/lifecycle.test-support";
import type { EntityRelationshipDefinitions } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/revision.test-support";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";

import { RecordedLogAnnotations, recordLogAnnotationsLayer } from "./log-annotations.test-support";
import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
	type ProviderEntityPopulationPayload,
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
		readonly payload: ProviderEntityPopulationPayload;
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
							operations: { details: relatedScript.slug },
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
			const payload: ProviderEntityPopulationPayload = {
				...payloadFields,
				providerId: provider.id,
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
				Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
				Layer.succeed(PluginRuntimeResolver, runtime),
				DomainWriteChecksLive,
				Layer.mock(EntitiesRepository)({ findEntityByExternalId: () => Effect.succeed(null) }),
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
					processSandbox: () => Effect.succeed(sandboxResult),
					processProviderResolve: () => Effect.die("unexpected provider resolve"),
				}),
				Layer.succeed(LifecycleExecution, {
					after: () => Effect.die("unexpected after"),
					executePolicy: () => Effect.die("unexpected policy"),
					skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
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
				ProviderEntityPopulationWorkflow,
				payload.executionId,
			);

			return yield* runProviderEntityPopulationWorkflow(payload, payload.executionId).pipe(
				Effect.tap(() =>
					Effect.gen(function* () {
						expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
							"root-upsert",
							"dispatch:root-upsert",
							"child-entity",
							"relationships",
							"dispatch:child-entity,entities-batch,relationships",
							"child-entity",
							"relationships",
							"dispatch:child-entity,entities-batch,relationships",
							"root-write",
							"dispatch:root-write",
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
				ProviderEntityPopulationWorkflow,
				payload.executionId,
			);
			const engine = makeMemoizingWorkflowEngine(instance, activityRuns);
			const run = runProviderEntityPopulationWorkflow(payload, payload.executionId).pipe(
				Effect.provideService(WorkflowInstance, instance),
				Effect.provideService(WorkflowEngine, engine),
			);

			const first = yield* run;
			const replayed = yield* run;
			expect(replayed).toEqual(first);
			expect(yield* (yield* FakePopulationWrites).recorded).toEqual([
				"root-upsert",
				"dispatch",
				"child-entity",
				"relationships",
				"dispatch",
				"child-entity",
				"relationships",
				"dispatch",
				"root-write",
				"dispatch",
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
			const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, executionId);
			return yield* Effect.gen(function* () {
				const error = yield* Effect.flip(
					runProviderEntityPopulationWorkflow(
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
