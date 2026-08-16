import { expect, it } from "@effect/vitest";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import {
	AutomationExecutionId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Layer, Logger, References } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import type { LifecyclePlan } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database } from "#lib/infrastructure/db/service";
import { RedisService } from "#lib/infrastructure/redis";
import {
	makeMemoizingWorkflowEngine,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";
import { planFixture } from "#modules/automations/lifecycle.test-support";
import {
	DefinitionRegistry,
	definitionSourceFromSnapshot,
	makeDefinitionRegistry,
	type DefinitionSnapshot,
} from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import {
	ProviderEntityPopulationWorkflow,
	runProviderEntityPopulationWorkflow,
} from "./provider-entity-population-workflow";

const now = IsoUtcString.make("2026-09-17T00:00:00.000Z");
const userId = UserId.make("population-user");
const providerId = SandboxProviderId.make("population-provider");
const rootSchemaSlug = EntitySchemaSlug.make("record");
const childSchemaSlug = EntitySchemaSlug.make("part");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("record-part");
const relatedSchemaSlug = EntitySchemaSlug.make("person");

const command = rootLifecycleCommand({
	occurredAt: now,
	source: "provider-refresh",
	itemIdentity: "population",
	initiator: { id: userId, kind: "user" },
	executionId: AutomationExecutionId.make("population-execution"),
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
		[rootSchemaSlug]: entityDefinition(rootSchemaSlug),
		[childSchemaSlug]: entityDefinition(childSchemaSlug),
		[relatedSchemaSlug]: entityDefinition(relatedSchemaSlug),
	},
	relationshipSchemas: {
		credits: {
			slug: "credits",
			name: "Credits",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: rootSchemaSlug,
			targetEntitySchemaSlug: relatedSchemaSlug,
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

const listedEntity = (id: string, entitySchemaSlug: EntitySchemaSlug): ListedEntity => ({
	providerId,
	createdAt: now,
	updatedAt: now,
	properties: {},
	name: "Record",
	externalId: id,
	populatedAt: now,
	entitySchemaSlug,
	id: EntityId.make(id),
});

const payload = {
	command,
	providerId,
	externalId: "record-1",
	mode: "refresh" as const,
	entitySchemaSlug: rootSchemaSlug,
	executionId: "population-workflow",
	entityScope: { userId, type: "global" as const },
};

const passthroughDatabase = Layer.succeed(
	Database,
	Database.of(
		Object.assign(Object.create(null), {
			transaction: ((body) =>
				body(Object.create(null))) satisfies Database["Service"]["transaction"],
		}),
	),
);

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

const populationLayer = (options: {
	readonly recorded: string[];
	readonly rootPlans?: ReadonlyArray<LifecyclePlan>;
	readonly dispatch: LifecycleExecution["Service"]["dispatch"];
}) =>
	Layer.mergeAll(
		passthroughDatabase,
		Layer.succeed(
			DefinitionRegistry,
			makeDefinitionRegistry(definitionSourceFromSnapshot(definitions)),
		),
		Layer.succeed(RedisService, makeRedisService({ publish: () => Effect.succeed(1) })),
		Layer.mock(PluginRuntimeResolver)({
			findProviderAvailableToUserBySlug: () => Effect.succeed(null),
		}),
		Layer.mock(EntitiesRepository)({
			findEntityByExternalId: () => Effect.succeed(null),
			findEntitySchemaProviderBySlug: () =>
				Effect.succeed({
					providerId,
					entitySchemaSlug: relatedSchemaSlug,
					detailsScriptId: SandboxScriptId.make("person-details"),
				}),
		}),
		Layer.mock(EntitiesService)({
			persistPlannedProviderUpsert: (input) =>
				Effect.sync(() => {
					const kind = input.populatedAt === null ? "upsert" : "write";
					const label = input.externalId === payload.externalId ? `root-${kind}` : "child-entity";
					options.recorded.push(label);
					const entity = listedEntity(input.externalId, input.entitySchemaSlug);
					return {
						plans:
							label === "root-upsert"
								? [...(options.rootPlans ?? [planFixture("root-upsert")])]
								: [planFixture(label)],
						result: {
							entity,
							wasInserted: true,
							outcome: {
								before: null,
								operation: "create" as const,
								after: { ...entity, properties: {} },
							},
						},
					};
				}),
		}),
		Layer.mock(RelationshipsRepository)({
			listRelationshipsForReconciliation: () => Effect.succeed([]),
		}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: (_groups, _command, _scope) =>
				Effect.sync(() => {
					options.recorded.push("relationships");
					return {
						plans: [planFixture("relationships")],
						result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }],
					};
				}),
		}),
		Layer.mock(EntityImportWorkflowOperations)({
			completeProviderEntityImport: () => Effect.void,
			processSandbox: () => Effect.succeed(sandboxResult),
		}),
		Layer.succeed(LifecycleExecution, {
			dispatch: options.dispatch,
			after: () => Effect.die("unexpected after"),
			executePolicy: () => Effect.die("unexpected policy"),
			skipQueuedPolicies: () => Effect.die("unexpected policy skip"),
		}),
	);

it.effect("dispatches each population write between activities and logs blocked hooks", () => {
	const recorded: string[] = [];
	const warningLogs: Array<Readonly<Record<string, unknown>>> = [];
	const logger = Logger.make<unknown, void>((options) => {
		if (String(options.message).includes("automation warnings")) {
			warningLogs.push(options.fiber.getRef(References.CurrentLogAnnotations));
		}
	});
	const blocked = {
		omittedHooks: [],
		hasRequiredHooks: true,
		code: "automation-limit-reached" as const,
	};
	const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, payload.executionId);

	return runProviderEntityPopulationWorkflow(payload, payload.executionId).pipe(
		Effect.tap(() => {
			expect(recorded).toEqual([
				"root-upsert",
				"dispatch:root-upsert",
				"child-entity",
				"relationships",
				"dispatch:child-entity,relationships",
				"child-entity",
				"relationships",
				"dispatch:child-entity,relationships",
				"root-write",
				"dispatch:root-write",
			]);
			expect(warningLogs.map((annotations) => annotations["phase"])).toEqual(["root-upsert"]);
			return Effect.void;
		}),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, makeWorkflowActivityEngine(instance)),
		Effect.provide(
			Layer.merge(
				Logger.layer([logger]),
				populationLayer({
					recorded,
					dispatch: (plans) =>
						Effect.sync(() => {
							recorded.push(`dispatch:${plans.map(({ triggerId }) => triggerId).join(",")}`);
							return plans.some(({ triggerId }) => triggerId === "root-upsert")
								? [{ ...blocked, triggerId: AutomationTriggerId.make("root-upsert") }]
								: [];
						}),
				}),
			),
		),
		Effect.asVoid,
	);
});

it.effect("replays the population body without re-running committed write activities", () => {
	const recorded: string[] = [];
	const activityRuns: string[] = [];
	const instance = WorkflowInstance.initial(ProviderEntityPopulationWorkflow, payload.executionId);
	const engine = makeMemoizingWorkflowEngine(instance, activityRuns);
	const run = runProviderEntityPopulationWorkflow(payload, payload.executionId).pipe(
		Effect.provideService(WorkflowInstance, instance),
		Effect.provideService(WorkflowEngine, engine),
	);

	return Effect.gen(function* () {
		const first = yield* run;
		const replayed = yield* run;
		expect(replayed).toEqual(first);
		expect(recorded).toEqual([
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
	}).pipe(
		Effect.provide(
			populationLayer({
				recorded,
				dispatch: () => Effect.sync(() => recorded.push("dispatch")).pipe(Effect.as([])),
			}),
		),
	);
});
