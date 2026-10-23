import { expect, it } from "@effect/vitest";
import type {
	IngestionBatch,
	IngestionIssue,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import type { GenericImportChunk } from "@ryot-app/plugin-backend-sdk/imports";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { CollectionsService } from "#modules/collections/service";
import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { buildDefinitionSnapshot } from "#modules/definitions/snapshot";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EventsService } from "#modules/events/service";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipsService } from "#modules/relationships/service";
import type { ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { makeWorkflowEngine } from "#testing/effect";

import { IngestionCaptures } from "./capture-service";
import {
	ProcessGenericImportChunksWorkflow,
	runProcessGenericImportChunksWorkflow,
} from "./generic-import-workflow";
import {
	ingestionTestDatabase,
	ingestionTestNow,
	ingestionTestRun,
	ingestionTestScope,
	ingestionTestSource,
} from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";

const command = rootLifecycleCommand({
	source: "import",
	lane: "background",
	itemIdentity: "root",
	importRunId: ingestionTestScope.runId,
	occurredAt: IsoUtcString.make(ingestionTestNow),
	accountGeneration: ingestionTestScope.accountGeneration,
	initiator: { kind: "user", id: ingestionTestScope.userId },
	executionId: AutomationExecutionId.make(ingestionTestScope.runId),
});
const domainCommand = {
	...command,
	writeContext: {
		providerId: null,
		contentHash: "hash",
		scriptSlug: "fixture",
		scriptId: ingestionTestSource.workflowScriptId,
		pluginRevision: ingestionTestSource.pluginRevision,
		metadata: { runtimeImports: [], kind: "workflow" as const },
		subject: {
			type: "user" as const,
			userId: ingestionTestScope.userId,
			accountGeneration: ingestionTestScope.accountGeneration,
		},
	},
};
const applyCase = (
	chunk: GenericImportChunk,
	cancelled = false,
	pluginRevision: ScriptPluginRevision = ingestionTestSource.pluginRevision,
) =>
	Effect.gen(function* () {
		const batches = new Map<string, IngestionBatch>();
		const outcomes = new Map<string, IngestionOutcome>();
		const issues = new Map<string, IngestionIssue>();
		const registrations: string[][] = [];
		let definitionReads = 0;
		const dependencies = Layer.mergeAll(
			ingestionTestDatabase(),
			Layer.mock(LifecycleExecution)({}),
			Layer.mock(EventsService)({}),
			Layer.mock(PluginRuntimeResolver)({
				findPluginAvailableToUser: () =>
					Effect.succeed({
						id: "plugin-1",
						slug: "fixture",
						health: "ready",
						isHidden: false,
						scope: "system",
						ownerUserId: null,
						clientImports: [],
						healthReason: null,
						compiledHashes: {},
						contentHash: "hash",
						incompatibilityReason: null,
						manifest: fixtureManifest(),
						pluginRevisionId: "revision-1",
						installationId: "installation-1",
						pluginConfigRevisionId: "config-1",
						packageId: ingestionTestSource.pluginRevision.packageId,
					}),
			}),
			Layer.mock(ImportSourceStateStore)({
				load: () => Effect.succeed({ ...ingestionTestSource, files: {}, pluginRevision }),
			}),
			Layer.mock(EntityImportWorkflowOperations)({}),
			Layer.succeed(
				WorkflowInstance,
				WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, "batch-owner"),
			),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					activityExecute: (activity) =>
						Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
				}),
			),
			Layer.mock(IngestionCaptures)({
				read: () => Effect.succeed(Buffer.from(JSON.stringify(chunk))),
			}),
			Layer.mock(ImportsRepository)({
				advanceBatch: () => Effect.succeed(true),
				getOutcome: (_scope, id) => Effect.sync(() => outcomes.get(id) ?? null),
				listBatches: () => Effect.sync(() => [...batches.values()].map((data) => ({ data }))),
				getBatchIssues: () => Effect.sync(() => [...issues.values()].map((data) => ({ data }))),
				getIngestionRun: () =>
					Effect.succeed(ingestionTestRun({ status: cancelled ? "cancelling" : "running" })),
				recordIssue: (_scope, issue) =>
					Effect.sync(() => {
						issues.set(issue.id, issue);
						return true;
					}),
				projectBatch: (_scope, batch) =>
					Effect.sync(() => {
						batches.set(batch.id, batch);
						return true;
					}),
				recordOutcome: (_scope, outcome) =>
					Effect.sync(() => {
						outcomes.set(outcome.operationId, outcome);
						return true;
					}),
				registerBatch: (_scope, batch, ids) =>
					Effect.sync(() => {
						registrations.push([...ids]);
						batches.set(batch.id, batch);
						return true;
					}),
				getCapture: () =>
					Effect.succeed({
						ordinal: 64,
						id: "capture",
						state: "sealed",
						checkpoint: null,
						phase: "application",
						payload: { byteSize: 0, locator: "owned", checksum: "fingerprint" },
					}),
			}),
			Layer.mock(DefinitionRepository)({
				getSnapshotForContext: () =>
					Effect.sync(() => {
						definitionReads++;
						return buildDefinitionSnapshot(kernelDefinitionSource());
					}),
			}),
			Layer.mock(EntitiesService)({}),
			Layer.mock(EntitiesRepository)({}),
			Layer.mock(RelationshipsService)({}),
			Layer.mock(CollectionsService)({}),
		);
		const payload = {
			...ingestionTestScope,
			ordinal: 0,
			batchId: "batch",
			captureId: "capture",
			executionId: "batch-owner",
			inputFingerprint: "fingerprint",
			artifactOwnerExecutionId: "run-1-import",
			artifactReferenceExecutionId: "batch-owner",
			command: {
				...domainCommand,
				writeContext: { ...domainCommand.writeContext, pluginRevision },
			},
		};
		const first = yield* runProcessGenericImportChunksWorkflow(payload, "batch-owner").pipe(
			Effect.provideContext(yield* Layer.build(dependencies)),
		);
		const replay = yield* runProcessGenericImportChunksWorkflow(payload, "batch-owner").pipe(
			Effect.provideContext(yield* Layer.build(dependencies)),
		);
		return { first, replay, issues, batches, outcomes, registrations, definitionReads };
	});

it.effect("projects source failures once and reuses the applied projection on replay", () =>
	Effect.gen(function* () {
		const result = yield* applyCase({
			items: [],
			failures: [
				{
					itemIndex: 4,
					unit: "plays",
					recordKind: "play",
					sourceLabel: "Export",
					operationId: "play-4",
					message: "invalid input",
					sourceIdentifier: "record-4",
				},
				{
					itemIndex: 4,
					unit: "plays",
					recordKind: "play",
					sourceLabel: "Export",
					message: "invalid input",
					operationId: "play-4-again",
					sourceIdentifier: "record-4",
				},
			],
		});
		expect(result.first.summary).toEqual([
			{
				unit: "plays",
				recordKind: "play",
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 2 },
			},
		]);
		expect(result.replay).toEqual(result.first);
		expect(result.registrations).toEqual([["play-4", "play-4-again"]]);
		expect([...result.outcomes.keys()]).toEqual(["play-4", "play-4-again"]);
		expect([...result.issues.keys()]).toEqual(["play-4", "play-4-again"]);
		expect(result.definitionReads).toBe(1);
		expect(result.first.issues[0]?.attribution).toEqual({
			recordId: "4",
			sourceLabel: "Export",
			sourceIdentifier: "record-4",
		});
	}),
);
it.effect("returns an empty applied batch without settling or sealing its root", () =>
	Effect.gen(function* () {
		const result = yield* applyCase({ items: [], failures: [] });
		expect(result.first).toEqual({ issues: [], summary: [], confirmed: [] });
		expect(result.batches.get("batch")?.state).toBe("applied");
	}),
);

it.effect("cannot use a kernel same-name schema through a plugin generic-import child", () =>
	Effect.gen(function* () {
		const result = yield* applyCase(
			{
				failures: [],
				items: [
					{
						events: [],
						itemIndex: 0,
						relationships: [],
						recordId: "foreign",
						sourceLabel: "Import",
						sourceIdentifier: "foreign",
						subjectEntityAlias: "entity",
						entities: [
							{
								properties: {},
								alias: "entity",
								name: "Collection",
								operationId: "foreign-entity",
								entitySchemaSlug: "collection",
								outcome: { unit: "entities", recordKind: "entity" },
							},
						],
					},
				],
			},
			false,
			{
				...ingestionTestSource.pluginRevision,
				schemaScope: {
					...ingestionTestSource.pluginRevision.schemaScope,
					entitySchemaSlugs: ["collection"],
				},
			},
		);
		expect(result.first.confirmed).toEqual([]);
		expect(result.first.summary).toEqual([
			{
				unit: "entities",
				recordKind: "entity",
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 1 },
			},
		]);
	}),
);

it.effect("rejects private global entity intents through the generic-import helper", () =>
	Effect.gen(function* () {
		const result = yield* applyCase(
			{
				failures: [],
				items: [
					{
						events: [],
						itemIndex: 0,
						relationships: [],
						recordId: "global",
						sourceLabel: "Import",
						sourceIdentifier: "global",
						subjectEntityAlias: "entity",
						entities: [
							{
								properties: {},
								alias: "entity",
								scope: "global",
								name: "Collection",
								operationId: "global-entity",
								entitySchemaSlug: "collection",
								outcome: { unit: "entities", recordKind: "entity" },
							},
						],
					},
				],
			},
			false,
			{
				...ingestionTestSource.pluginRevision,
				scope: "user",
				ownerId: ingestionTestScope.userId,
				schemaScope: {
					...ingestionTestSource.pluginRevision.schemaScope,
					entitySchemaSlugs: ["collection"],
				},
			},
		);
		expect(result.first.confirmed).toEqual([]);
		expect(result.first.summary).toEqual([
			{
				unit: "entities",
				recordKind: "entity",
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 1 },
			},
		]);
	}),
);
it.effect("keeps original event attribution when preparation fails a grouped item", () =>
	Effect.gen(function* () {
		const result = yield* applyCase({
			failures: [],
			items: [
				{
					itemIndex: 0,
					recordId: "group",
					relationships: [],
					sourceLabel: "Group",
					sourceIdentifier: "group",
					subjectEntityAlias: "subject",
					entities: [
						{
							properties: {},
							name: "Subject",
							alias: "subject",
							operationId: "support",
							entitySchemaSlug: "missing-schema",
						},
					],
					events: [
						{
							properties: {},
							operationId: "play-1",
							entityAlias: "subject",
							eventSchemaSlug: "review",
							occurredAt: ingestionTestNow,
							outcome: { unit: "plays", recordKind: "play" },
							attribution: {
								sourceLabel: "History",
								recordId: "original-play",
								sourceIdentifier: "track/time",
							},
						},
					],
				},
			],
		});
		expect(result.first.summary).toEqual([
			{
				unit: "plays",
				recordKind: "play",
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 1 },
			},
		]);
		expect(result.registrations).toEqual([["support", "play-1"]]);
		expect(result.first.issues[0]?.attribution?.recordId).toBe("original-play");
		expect(result.first.confirmed).toEqual([]);
	}),
);
