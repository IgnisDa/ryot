import { assert, expect, it } from "@effect/vitest";
import type {
	IngestionBatch,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import { AutomationExecutionId, EventId, IntegrationId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { buildDefinitionSnapshot } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { EntityImportWorkflowOperations } from "#modules/provider-entities/operations-workflow";
import { RelationshipsService } from "#modules/relationships/service";
import { ManagedAssetsService } from "#modules/uploads/managed-assets/service";

import { IngestionCaptures } from "./capture-service";
import { DataGraphRecordSchema, type DataGraphRecord } from "./data-graph";
import {
	ProcessDataImportWorkflow,
	ProcessDataImportSegmentWorkflow,
	runDataImportSegmentWorkflow,
	runDataImportWorkflow,
} from "./data-workflow";
import { IngestionExecution } from "./execution-service";
import {
	ingestionTestDatabase,
	ingestionTestNow,
	ingestionTestReceipt,
	ingestionTestRun,
	ingestionTestScope,
} from "./ingestion.test-support";
import { ingestionItemIdentity } from "./outcomes";
import { ImportsRepository } from "./repository";

const snapshot = buildDefinitionSnapshot({
	savedViews: [],
	signalSchemas: [],
	relationshipSchemas: [],
	entitySchemas: [
		{
			icon: "file",
			name: "Record",
			slug: "record",
			pluginSlug: null,
			propertiesSchema: { fields: {} },
			eventSchemas: [
				{
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
	itemIdentity: "root",
	importRunId: ingestionTestScope.runId,
	occurredAt: IsoUtcString.make(ingestionTestNow),
	accountGeneration: ingestionTestScope.accountGeneration,
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
const fixture = Effect.fnUntraced(function* (cancelAfterWrite = false) {
	let run = ingestionTestRun();
	const receipts: ReturnType<typeof ingestionTestReceipt>[] = [];
	const outcomes = new Map<string, IngestionOutcome>();
	const projections: IngestionBatch[] = [];
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
		ingestionTestDatabase(() => receipts),
		Layer.succeed(
			WorkflowInstance,
			WorkflowInstance.initial(ProcessDataImportSegmentWorkflow, "segment-owner"),
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
		Layer.mock(LifecycleExecution)({}),
		Layer.mock(PluginRuntimeResolver)({}),
		Layer.mock(EntityImportWorkflowOperations)({}),
		Layer.mock(EntitiesRepository)({}),
		Layer.mock(RelationshipsService)({}),
		Layer.mock(ManagedAssetsService)({ verifyManagedAssetOwnership: () => Effect.succeed([]) }),
		Layer.mock(EventsService)({
			create: (input, lifecycle) =>
				Effect.sync(() => {
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
					if (!receipts.some((receipt) => receipt.itemIdentity === lifecycle.itemIdentity)) {
						receipts.push(
							ingestionTestReceipt(`data:event:${key}`, "event:create", {
								eventId: key,
								processed: [],
							}),
						);
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
			advanceBatch: () => Effect.succeed(true),
			getIngestionRun: () => Effect.sync(() => run),
			getOutcome: (_scope, id) => Effect.sync(() => outcomes.get(id) ?? null),
			projectBatch: (_scope, value) =>
				Effect.sync(() => {
					projections.push(value);
					return true;
				}),
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
	const execute = runDataImportSegmentWorkflow({
		batch,
		command,
		snapshot,
		...ingestionTestScope,
		relationshipIds: {},
		failedKeys: ["failed"],
		executionId: "segment-owner",
		entityIds: { subject: "subject-id", related: "related-id" },
		entitySchemasByKey: { failed: "record", subject: "record" },
		startingCounters: { totalItems: 54, failedItems: 1, importedItems: 49, processedItems: 50 },
	}).pipe(Effect.provideContext(context));
	return { execute, outcomes, receipts, submitted, projections };
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
			expect(test.receipts.map((receipt) => receipt.itemIdentity)).toEqual([
				ingestionItemIdentity(ingestionTestScope.runId, "data:event:written"),
				ingestionItemIdentity(ingestionTestScope.runId, "data:event:independent"),
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
);

it.effect(
	"stops future Data records after cancellation and projects the just-committed receipt",
	() =>
		Effect.gen(function* () {
			const test = yield* fixture(true);
			yield* test.execute;
			expect(test.submitted).toHaveLength(1);
			expect(test.receipts).toHaveLength(1);
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
);

it.effect(
	"registers integration Data planning failures under the actual child owner and leaves root settlement to the integration",
	() =>
		Effect.gen(function* () {
			const captured = new Map<string, Parameters<IngestionCaptures["Service"]["publish"]>[0]>();
			const owners: { workflowName: string; executionId: string }[] = [];
			const segments: (typeof ProcessDataImportSegmentWorkflow.payloadSchema.Type)[] = [];
			const outcomes = new Map<string, IngestionOutcome>();
			let sealed = false;
			const integrationId = IntegrationId.make("integration");
			const integrationCommand = rootLifecycleCommand({
				integrationId,
				itemIdentity: "root",
				source: "integration",
				importRunId: ingestionTestScope.runId,
				occurredAt: IsoUtcString.make(ingestionTestNow),
				initiator: { id: integrationId, kind: "integration" },
				accountGeneration: ingestionTestScope.accountGeneration,
				executionId: AutomationExecutionId.make(ingestionTestScope.runId),
			});
			const dependencies = Layer.mergeAll(
				ingestionTestDatabase(),
				Layer.succeed(
					WorkflowInstance,
					WorkflowInstance.initial(ProcessDataImportWorkflow, "data-owner"),
				),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						activityExecute: (activity) =>
							Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
						execute: (_workflow, options) =>
							Effect.gen(function* () {
								const payload = yield* Schema.decodeUnknownEffect(
									ProcessDataImportSegmentWorkflow.payloadSchema,
								)(options.payload);
								segments.push(payload);
								const capture = captured.get(payload.batch.captureId);
								assert(capture);
								const records = yield* Schema.decodeEffect(
									Schema.fromJsonString(Schema.Array(DataGraphRecordSchema)),
								)(new TextDecoder().decode(capture.bytes));
								return {
									failedKeys: [],
									relationshipIds: {},
									entityIds: Object.fromEntries(
										records
											.filter((item) => item.kind === "entity")
											.map((item) => [item.record.key, `id:${item.record.key}`]),
									),
									counters: {
										...payload.startingCounters,
										importedItems: payload.startingCounters.importedItems + records.length,
										processedItems: payload.startingCounters.processedItems + records.length,
									},
								};
							}),
					}),
				),
				Layer.mock(IngestionExecution)({}),
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
					read: () =>
						Effect.succeed(
							Buffer.from(
								stableStringify({
									relationships: [],
									events: [
										{
											key: "event",
											entityKey: "entity-50",
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
											entitySchemaSlug: "unavailable",
										},
										...Array.from({ length: 51 }, (_, index) => ({
											kind: "custom",
											properties: {},
											key: `entity-${index}`,
											name: `Entity ${index}`,
											entitySchemaSlug: "record",
										})),
									],
								}),
							),
						),
				}),
				Layer.mock(ImportsRepository)({
					recordIssue: () => Effect.succeed(true),
					projectBatch: () => Effect.succeed(true),
					getOutcome: (_scope, id) => Effect.sync(() => outcomes.get(id) ?? null),
					getIngestionRun: () => Effect.succeed(ingestionTestRun({ integrationId })),
					sealCollection: () =>
						Effect.sync(() => {
							sealed = true;
						}),
					registerBatch: (_scope, _batch, _operations, owner) =>
						Effect.sync(() => {
							owners.push(owner);
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
			yield* runDataImportWorkflow(
				{ ...ingestionTestScope, command: integrationCommand },
				"data-owner",
			).pipe(Effect.provideContext(yield* Layer.build(dependencies)));
			expect(owners).toEqual([
				{ executionId: "data-owner", workflowName: ProcessDataImportWorkflow._tag },
				{
					executionId: "data-owner-segment-0",
					workflowName: ProcessDataImportSegmentWorkflow._tag,
				},
				{
					executionId: "data-owner-segment-1",
					workflowName: ProcessDataImportSegmentWorkflow._tag,
				},
			]);
			expect(segments).toHaveLength(2);
			expect(segments[0]?.startingCounters.processedItems).toBe(1);
			expect(segments[1]?.startingCounters.processedItems).toBe(51);
			expect(segments[1]?.entityIds).toEqual({ "entity-0": "id:entity-0" });
			expect(segments[1]?.entitySchemasByKey).toEqual({ "entity-50": "record" });
			expect(sealed).toBe(true);
			expect(outcomes.get("data-plan:0:unknown")?.result).toBe("unsuccessful");
		}),
);
