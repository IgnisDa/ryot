import { BunCrypto } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import type {
	IngestionIssue,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import { AutomationExecutionId, ImportRunId } from "@ryot-app/contract/schema/brands";
import type { GenericImportWriteItem } from "@ryot-app/plugin-backend-sdk/imports";
import { randomUuid } from "@ryot-app/testing/random";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { CollectionsService } from "#modules/collections/service";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import {
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "#modules/events/event-groups.test-support";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { IngestionCaptures } from "./capture-service";
import {
	ProcessGenericImportChunksWorkflow,
	runProcessGenericImportChunksWorkflow,
} from "./generic-import-workflow";
import { ingestionTestRun, ingestionTestSource } from "./ingestion.test-support";
import { genericImportOperationIdentity } from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";

const recordFixture = Effect.fnUntraced(function* (memberCount: number) {
	const fixture = yield* eventGroupFixture();
	const revision = fixture.command.writeContext.pluginRevision;
	assert(revision);
	const accountGeneration = fixture.command.accountGeneration;
	assert(accountGeneration);
	const active = yield* (yield* PluginRuntimeResolver).findPluginAvailableToUser(
		fixture.userId,
		revision.id,
	);
	assert(active?.installationId);
	const runId = ImportRunId.make(yield* randomUuid);
	const command = {
		...rootLifecycleCommand({
			source: "import",
			accountGeneration,
			lane: "background",
			importRunId: runId,
			itemIdentity: "record",
			occurredAt: fixture.command.occurredAt,
			executionId: AutomationExecutionId.make(runId),
			initiator: { kind: "user", id: fixture.userId },
		}),
		writeContext: fixture.command.writeContext,
	};
	const item: GenericImportWriteItem = {
		itemIndex: 0,
		recordId: "record",
		sourceLabel: "fixture",
		sourceIdentifier: "record",
		subjectEntityAlias: "session",
		relationships: [
			{
				properties: {},
				operationId: "link",
				targetAlias: "other",
				sourceAlias: "subject",
				outcome: { unit: "links", recordKind: "links" },
				relationshipSchemaSlug: fixture.relationshipSchemaSlug,
			},
		],
		entities: [
			{
				properties: {},
				name: "Subject",
				alias: "subject",
				existingOnly: true,
				operationId: "subject",
				entityId: fixture.subjectId,
				entitySchemaSlug: "subject",
			},
			{
				name: "Other",
				alias: "other",
				properties: {},
				operationId: "other",
				entitySchemaSlug: "subject",
			},
			{
				properties: {},
				alias: "session",
				operationId: "session",
				name: "Imported session",
				entitySchemaSlug: "session",
				outcome: { unit: "sessions", recordKind: "sessions" },
			},
		],
		events: [
			{
				operationId: "anchor",
				entityAlias: "subject",
				eventSchemaSlug: "anchor",
				sessionEntityAlias: "session",
				occurredAt: command.occurredAt,
				properties: { position: 0, kind: "primary", evidence: "recorded" },
			},
			...Array.from({ length: memberCount }, (_, index) => ({
				entityAlias: "subject",
				eventSchemaSlug: "member",
				sessionEntityAlias: "session",
				occurredAt: command.occurredAt,
				operationId: `member-${index}`,
				outcome: { unit: "members", recordKind: "members" },
				properties: { position: 0, amount: index, kind: "primary" },
			})),
		],
	};
	const outcomes = new Map<string, IngestionOutcome>();
	const issues = new Map<string, IngestionIssue>();
	const scope = { runId, accountGeneration, userId: fixture.userId };
	const importLayer = Layer.mergeAll(
		Layer.mock(EventsService)({}),
		Layer.mock(ImportSourceStateStore)({
			load: () =>
				Effect.succeed({
					...ingestionTestSource,
					files: {},
					pluginId: revision.id,
					pluginRevision: revision,
					pluginInstallationId: active.installationId,
				}),
		}),
		Layer.mock(IngestionCaptures)({
			read: () => Effect.succeed(Buffer.from(JSON.stringify({ failures: [], items: [item] }))),
		}),
		Layer.mock(ImportsRepository)({
			listBatches: () => Effect.succeed([]),
			startBatch: () => Effect.succeed(true),
			projectBatch: () => Effect.succeed(true),
			registerBatch: () => Effect.succeed(true),
			getOutcome: (_scope, id) => Effect.sync(() => outcomes.get(id) ?? null),
			getBatchIssues: () => Effect.sync(() => [...issues.values()].map((data) => ({ data }))),
			recordIssue: (_scope, issue) =>
				Effect.sync(() => {
					issues.set(issue.id, issue);
					return true;
				}),
			recordOutcome: (_scope, outcome) =>
				Effect.sync(() => {
					outcomes.set(outcome.operationId, outcome);
					return true;
				}),
			getCapture: () =>
				Effect.succeed({
					ordinal: 0,
					id: "capture",
					state: "sealed",
					checkpoint: null,
					phase: "application",
					payload: { byteSize: 0, locator: "owned", checksum: "fingerprint" },
				}),
			getIngestionRunControl: () =>
				Effect.succeed(
					ingestionTestRun({
						...scope,
						id: runId,
						pluginInstallationId: active.installationId,
						pins: {
							scriptId: "script-1",
							executionId: "import-owner",
							pluginRevisionId: revision.revisionId,
							pluginConfigRevisionId: revision.configRevisionId,
						},
					}),
				),
		}),
		Layer.succeed(
			WorkflowInstance,
			WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, runId),
		),
	);
	const apply = runProcessGenericImportChunksWorkflow(
		{
			...scope,
			command,
			ordinal: 0,
			batchId: "batch",
			executionId: runId,
			captureId: "capture",
			inputFingerprint: "fingerprint",
			artifactReferenceExecutionId: runId,
			artifactOwnerExecutionId: "import-owner",
		},
		runId,
	).pipe(Effect.provideContext(yield* Layer.build(importLayer)));
	const receiptIdentities = [
		"session",
		"anchor",
		"link",
		...Array.from({ length: memberCount }, (_, index) => `member-${index}`),
	].map((id) => genericImportOperationIdentity(runId, item, id));
	const committed = Effect.flatMap(MutationReceipts.make, (receipts) =>
		receipts.getCommittedItems({
			accountGeneration,
			rootExecutionId: runId,
			userId: fixture.userId,
			itemIdentities: receiptIdentities,
		}),
	);
	return { ...fixture, apply, outcomes, committed };
});

layer(
	Layer.provideMerge(
		Layer.mergeAll(
			eventGroupWorkflowLayer,
			Layer.mock(CollectionsService)({}),
			Layer.mock(EntityImportWorkflowOperations)({}),
		),
		BunCrypto.layerSecureRandom,
	),
)((test) => {
	test.effect(
		"atomically imports the subject, relationships, and complete group and replays original receipts",
		() =>
			Effect.gen(function* () {
				const fixture = yield* recordFixture(101);
				yield* fixture.apply;
				yield* fixture.apply;
				expect([...fixture.outcomes.values()]).toEqual([]);
				expect(yield* fixture.committed).toHaveLength(104);
				const database = yield* DatabaseSession;
				expect(
					yield* database.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.entityId, fixture.subjectId)),
					),
				).toHaveLength(102);
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.relationship)
							.where(eq(tables.relationship.sourceEntityId, fixture.subjectId)),
					),
				).toHaveLength(1);
			}),
	);

	test.effect(
		"rolls back a grouped import's subject, relationships, events, and record receipts together",
		() =>
			Effect.gen(function* () {
				const fixture = yield* recordFixture(0);
				yield* fixture.apply;
				expect([...fixture.outcomes.values()].map((outcome) => outcome.result)).toEqual([
					"unsuccessful",
					"unsuccessful",
				]);
				expect(yield* fixture.committed).toEqual([]);
				const database = yield* DatabaseSession;
				expect(
					yield* database.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.entityId, fixture.subjectId)),
					),
				).toHaveLength(0);
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.relationship)
							.where(eq(tables.relationship.sourceEntityId, fixture.subjectId)),
					),
				).toHaveLength(0);
				expect(
					(yield* database.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(eq(tables.entity.entitySchemaPluginId, fixture.installed.pluginId)),
					)).filter((row) => row.entitySchemaSlug === "session"),
				).toHaveLength(0);
			}),
	);
});
