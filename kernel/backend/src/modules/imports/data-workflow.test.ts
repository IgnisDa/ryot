import { expect } from "bun:test";

import type {
	IngestionBatch,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	EventId,
	IntegrationId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { DefinitionRepository } from "#modules/definitions/repository";
import { buildDefinitionSnapshot } from "#modules/definitions/snapshot";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { ProcessIntegrationRunWorkflow } from "#modules/integrations/integration-workflow";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { RelationshipsService } from "#modules/relationships/service";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import { makeWorkflowEngine, workflowAccountsTestLayer } from "#testing/effect";

import { IngestionCaptures } from "./capture-service";
import type { DataGraphRecord } from "./data-graph";
import {
	runDataImportSegment,
	runDataImportWorkflow,
} from "./data-workflow";
import { IngestionExecution } from "./execution-service";
import {
	ingestionTestDatabase,
	ingestionTestItem,
	ingestionTestNow,
	ingestionTestRun,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ingestionItemIdentity } from "./outcomes";
import { ImportsRepository } from "./repository";

const snapshot = buildDefinitionSnapshot({
	savedViews: [],
	signalSchemas: [],
	calendarSources: [],
	relationshipSchemas: [],
	entitySchemas: [
		{
			icon: "file",
			pluginId: null,
			name: "Record",
			slug: "record",
			propertiesSchema: { fields: {} },
			eventSchemas: [
				{
					pluginId: null,
					name: "Recorded",
					slug: "recorded",
					propertiesSchema: {
						fields: {
							related: {
								type: "object",
								label: "Related",
								description: "Related records",
								properties: {
									entity: {
										type: "string",
										label: "Entity",
										description: "Related entity",
										reference: { kind: "entity-id" },
									},
								},
							},
						},
					},
				},
			],
		},
	],
});
const command = rootLifecycleCommand({
	source: "import",
	lane: "background",
	itemIdentity: "root",
	importRunId: ingestionTestScope.runId,
	accountUserId: ingestionTestScope.userId,
	occurredAt: IsoUtcString.make(ingestionTestNow),
	initiator: { kind: "user", id: ingestionTestScope.userId },
	executionId: AutomationExecutionId.make(ingestionTestScope.runId),
});
const event = (key: string, entityKey = "subject"): DataGraphRecord => ({
	kind: "event",
	record: {
		key,
		entityKey,
		eventSchemaSlug: "recorded",
		occurredAt: ingestionTestNow,
		properties: { related: { entity: "related" } },
	},
});
const fixture = Effect.fnUntraced(function* (cancelAfterWrite?: boolean) {
	let run = ingestionTestRun();
	const items: ReturnType<typeof ingestionTestItem>[] = [];
	const outcomes = new Map<string, IngestionOutcome>();
	const projections: IngestionBatch[] = [];
	const starts: Parameters<ImportsRepository["Service"]["startBatch"]>[] = [];
	const submitted: Parameters<EventsService["Service"]["create"]>[0][] = [];
	const records = [
		event("written"),
		event("skipped"),
		event("failed-dependency", "failed"),
		event("independent"),
	];
	const batch: IngestionBatch = {
		ordinal: 1,
		summary: [],
		id: "segment",
		state: "pending",
		captureId: "segment",
		inputFingerprint: "fingerprint",
	};
	const dependencies = Layer.mergeAll(
		workflowAccountsTestLayer,
		ingestionTestDatabase(() => items),
		Layer.succeed(
			WorkflowInstance,
			WorkflowInstance.initial(ProcessImportRunWorkflow, "segment-owner"),
		),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				activityExecute: (activity) =>
					Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
			}),
		),
		Layer.mock(IngestionCaptures)({
			read: () => Effect.succeed(Buffer.from(stableStringify(records))),
		}),
		Layer.mock(EntitiesService)({}),
		Layer.mock(JobQueue)({}),
		Layer.mock(TransientValues)({}),
		Layer.mock(LifecycleExecution)({}),
		Layer.mock(PluginRuntimeResolver)({}),
		Layer.mock(EntityImportWorkflowOperations)({}),
		Layer.mock(EntitiesRepository)({}),
		Layer.mock(RelationshipsService)({}),
		Layer.mock(ManagedAssetsService)({ verifyManagedAssetOwnership: () => Effect.succeed([]) }),
		Layer.mock(EventsService)({
			create: (input) =>
				Effect.sync(() => {
					const lifecycle = input.command;
					submitted.push(input);
					const key =
						["skipped", "independent"].find((value) => lifecycle.itemIdentity.includes(value)) ??
						"written";
					if (key === "skipped") {
						return {
							count: 0,
							warnings: [],
							failure: null,
							outcomes: [{ index: 0, reason: "filtered", status: "skipped_by_policy" as const }],
						};
					}
					const item = ingestionTestItem(lifecycle.itemIdentity, "created");
					if (!items.some(({ id }) => id === item.id)) {
						items.push(item);
					}
					if (cancelAfterWrite) {
						run = { ...run, status: "cancelling" };
					}
					return {
						count: 1,
						warnings: [],
						failure: null,
						outcomes: [{ index: 0, status: "written" as const, eventId: EventId.make(key) }],
					};
				}),
		}),
		Layer.mock(ImportsRepository)({
			recordIssue: () => Effect.succeed(true),
			getIngestionRunControl: () => Effect.sync(() => run),
			getOutcome: (_scope, id) => Effect.sync(() => outcomes.get(id) ?? null),
			startBatch: (...input) =>
				Effect.sync(() => {
					starts.push(input);
					return true;
				}),
			projectBatch: (_scope, value) =>
				Effect.sync(() => {
					projections.push(value);
					return true;
				}),
			storeBatchResult: () => Effect.void,
			recordOutcome: (_scope, outcome) =>
				Effect.sync(() => {
					outcomes.set(outcome.operationId, outcome);
					return true;
				}),
			getCapture: () =>
				Effect.succeed({
					ordinal: 65,
					id: batch.id,
					payload: null,
					state: "sealed",
					phase: "application",
					checkpoint: records.map((item) => ({
						unit: "events",
						recordKind: "event",
						operationId: `data:event:${item.record.key}`,
						itemIdentity: ingestionItemIdentity(
							ingestionTestScope.runId,
							`data:event:${item.record.key}`,
						),
						attribution: {
							sourceLabel: "data-json",
							recordId: item.record.key,
							sourceIdentifier: item.record.key,
						},
					})),
				}),
		}),
	);
	const context = yield* Layer.build(dependencies);
	const execute = runDataImportSegment({
		batch,
		snapshot,
		command: { ...command, writeContext: null },
		...ingestionTestScope,
		relationshipIds: {},
		failedKeys: ["failed"],
		entityIds: { subject: "subject-id", related: "related-id" },
		startingCounters: { totalItems: 54, failedItems: 1, importedItems: 49, processedItems: 50 },
		entitySchemasByKey: {
			failed: { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("record") },
			subject: { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("record") },
		},
	}).pipe(Effect.provideContext(context));
	return { items, starts, execute, outcomes, submitted, projections };
});

it.effect(
	"rewrites nested references, isolates failed dependencies and replays event identities with an advanced segment offset",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture();
			const first = yield* test.execute;
			const replay = yield* test.execute;
			expect(first.failedKeys).toEqual(["failed-dependency"]);
			expect(replay).toEqual(first);
			expect(test.starts).toEqual([
				[ingestionTestScope, "segment"],
				[ingestionTestScope, "segment"],
			]);
			expect(test.items).toEqual([
				ingestionTestItem(
					ingestionItemIdentity(ingestionTestScope.runId, "data:event:written"),
					"created",
				),
				ingestionTestItem(
					ingestionItemIdentity(ingestionTestScope.runId, "data:event:independent"),
					"created",
				),
			]);
			expect(test.submitted[0]?.payload[0]?.properties).toEqual({
				related: { entity: "related-id" },
			});
			expect(test.outcomes.get("data:event:skipped")?.result).toBe("skipped");
			expect(test.outcomes.get("data:event:failed-dependency")?.result).toBe("unsuccessful");
			expect(test.projections).toHaveLength(2);
			expect(test.projections[0]?.summary).toEqual([
				{
					unit: "events",
					recordKind: "event",
					counts: { created: 2, updated: 0, skipped: 1, unchanged: 0, unsuccessful: 1 },
				},
			]);
			expect(test.projections[1]).toEqual(test.projections[0]);
		}),
	testTimeout,
);

it.effect(
	"stops future Data records after cancellation and projects the just-committed item",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture(true);
			yield* test.execute;
			expect(test.submitted).toHaveLength(1);
			expect(test.items).toHaveLength(1);
			const projection = test.projections[0];
			assert(projection);
			expect(projection.state).toBe("applied");
			expect(projection.summary).toEqual([
				{
					unit: "events",
					recordKind: "event",
					counts: { created: 1, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 0 },
				},
			]);
		}),
	testTimeout,
);

it.effect(
	"continues from applied segments without settling an integration's run",
	() =>
		Effect.gen(function* () {
			const entityKeys = Array.from({ length: 50 }, (_, index) => `entity-${index}`);
			const captured = new Map<string, Parameters<IngestionCaptures["Service"]["publish"]>[0]>();
			const registered: string[] = [];
			const submitted: Parameters<EventsService["Service"]["create"]>[0][] = [];
			const outcomes = new Map<string, IngestionOutcome>();
			let sealed = false;
			const integrationId = IntegrationId.make("integration");
			const integrationCommand = rootLifecycleCommand({
				integrationId,
				lane: "background",
				itemIdentity: "root",
				source: "integration",
				importRunId: ingestionTestScope.runId,
				accountUserId: ingestionTestScope.userId,
				occurredAt: IsoUtcString.make(ingestionTestNow),
				initiator: { id: integrationId, kind: "integration" },
				executionId: AutomationExecutionId.make(ingestionTestScope.runId),
			});
			const document = stableStringify({
				relationships: [],
				events: [
					{
						key: "event",
						entityKey: "entity-49",
						eventSchemaSlug: "recorded",
						occurredAt: ingestionTestNow,
						properties: { related: { entity: "entity-0" } },
					},
				],
				entities: [
					{
						key: "unknown",
						kind: "custom",
						properties: {},
						name: "Unknown",
						entitySchema: { slug: "unavailable", owner: { kind: "kernel" } },
					},
					...entityKeys.map((key) => ({
						key,
						name: key,
						kind: "custom",
						properties: {},
						entitySchema: { slug: "record", owner: { kind: "kernel" } },
					})),
				],
			});
			const dependencies = Layer.mergeAll(
				workflowAccountsTestLayer,
				ingestionTestDatabase(),
				Layer.succeed(
					WorkflowInstance,
					WorkflowInstance.initial(ProcessIntegrationRunWorkflow, "integration-root"),
				),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						activityExecute: (activity) =>
							Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
					}),
				),
				Layer.mock(IngestionExecution)({}),
				Layer.mock(EntitiesService)({}),
				Layer.mock(LifecycleExecution)({}),
				Layer.mock(PluginRuntimeResolver)({}),
				Layer.mock(EntityImportWorkflowOperations)({}),
				Layer.mock(JobQueue)({}),
				Layer.mock(TransientValues)({}),
				Layer.mock(EntitiesRepository)({}),
				Layer.mock(RelationshipsService)({}),
				Layer.mock(ManagedAssetsService)({ verifyManagedAssetOwnership: () => Effect.succeed([]) }),
				Layer.mock(EventsService)({
					create: (input) =>
						Effect.sync(() => {
							submitted.push(input);
							return { count: 1, outcomes: [], warnings: [], failure: null };
						}),
				}),
				Layer.mock(DefinitionRepository)({ getUserSnapshot: () => Effect.succeed(snapshot) }),
				Layer.mock(IngestionCaptures)({
					publish: (input) =>
						Effect.sync(() => {
							captured.set(input.id, input);
							return {
								...input,
								payload: {
									locator: input.id,
									checksum: input.id,
									byteSize: input.bytes.byteLength,
								},
							};
						}),
					read: (_scope, id) =>
						Effect.sync(() =>
							Buffer.from(captured.get(id)?.bytes ?? new TextEncoder().encode(document)),
						),
				}),
				Layer.mock(ImportsRepository)({
					recordIssue: () => Effect.succeed(true),
					projectBatch: () => Effect.succeed(true),
					startBatch: () => Effect.succeed(true),
					storeBatchResult: () => Effect.void,
					getOutcome: (_scope, id) => Effect.sync(() => outcomes.get(id) ?? null),
					sealCollection: () =>
						Effect.sync(() => {
							sealed = true;
						}),
					getIngestionRunControl: () => Effect.succeed(ingestionTestRun({ integrationId })),
					listBatches: () =>
						Effect.succeed([
							{
								data: {
									ordinal: 1,
									summary: [],
									state: "applied" as const,
									id: "data-segment:0",
									captureId: "data-segment:0",
									inputFingerprint: "data-segment:0",
								},
								result: {
									failedKeys: [],
									relationshipIds: {},
									entityIds: Object.fromEntries(entityKeys.map((key) => [key, `id:${key}`])),
									counters: { totalItems: 52, failedItems: 1, importedItems: 50, processedItems: 51 },
								},
							},
						]),
					registerBatch: (_scope, batch) =>
						Effect.sync(() => {
							registered.push(batch.id);
							return true;
						}),
					recordOutcome: (_scope, outcome) =>
						Effect.sync(() => {
							outcomes.set(outcome.operationId, outcome);
							return true;
						}),
					getCapture: (_scope, id) =>
						Effect.sync(() => {
							const input = captured.get(id);
							assert(input);
							return { ...input, payload: null };
						}),
				}),
			);
			yield* runDataImportWorkflow({ ...ingestionTestScope, command: integrationCommand }).pipe(
				Effect.scoped,
				Effect.provideContext(yield* Layer.build(dependencies)),
			);
			expect(registered).toEqual(["data-plan:0", "data-segment:1"]);
			expect(submitted).toHaveLength(1);
			expect(submitted[0]?.payload[0]).toMatchObject({
				entityId: "id:entity-49",
				properties: { related: { entity: "id:entity-0" } },
			});
			expect(sealed).toBe(true);
			expect(outcomes.get("data-plan:0:unknown")?.result).toBe("unsuccessful");
		}),
	testTimeout,
);
