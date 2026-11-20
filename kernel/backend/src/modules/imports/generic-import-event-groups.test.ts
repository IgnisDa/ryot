import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import type {
	IngestionIssue,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import { AutomationExecutionId, ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import type { GenericImportWriteItem } from "@ryot-app/plugin-backend-sdk/imports";
import { assert } from "@ryot-app/testing/assert";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { CollectionsService } from "#modules/collections/service";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import {
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "#modules/events/event-groups.test-support";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import * as tables from "#schema/tables/combined";
import { importRun } from "#schema/tables/imports";
import { makeWorkflowEngine } from "#testing/effect";

import { IngestionCaptures } from "./capture-service";
import { runGenericImportChunk } from "./generic-import-workflow";
import { ingestionTestRun, ingestionTestSource } from "./ingestion.test-support";
import { IntegrationEventWrites } from "./integration-event-writes";
import { genericImportOperationIdentity } from "./outcomes";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";

const noteSchemas = [
	{
		slug: "note",
		name: { key: "test.note" },
		propertiesSchema: {
			fields: {
				image: managedAssetProperty,
				text: { type: "string", description: "Text", label: { key: "test.text" } },
			},
		},
	},
] as const;

/**
 * Applies a chunk of one item built for the fixture. Every application runs each activity again, as
 * a retry after a commit whose activity result was lost.
 */
const chunkFixture = Effect.fnUntraced(function* (
	eventSchemas: Parameters<typeof eventGroupFixture>[0],
	itemOf: (
		fixture: Effect.Success<ReturnType<typeof eventGroupFixture>>,
		occurredAt: string,
	) => GenericImportWriteItem,
	identities: ReadonlyArray<string>,
) {
	const fixture = yield* eventGroupFixture(eventSchemas);
	const revision = fixture.command.writeContext.pluginRevision;
	assert(revision);
	const accountUserId = fixture.command.accountUserId;
	assert(accountUserId);
	const active = yield* (yield* PluginRuntimeResolver).findPluginAvailableToUser(
		fixture.userId,
		revision.id,
	);
	assert(active?.installationId);
	const runId = ImportRunId.make(yield* randomUuid);
	yield* (yield* DatabaseSession).run((db) =>
		db.insert(importRun).values({ id: runId, source: "fixture", userId: fixture.userId }),
	);
	const command = {
		...rootLifecycleCommand({
			accountUserId,
			source: "import",
			lane: "background",
			importRunId: runId,
			itemIdentity: "record",
			occurredAt: fixture.command.occurredAt,
			executionId: AutomationExecutionId.make(runId),
			initiator: { kind: "user", id: fixture.userId },
		}),
		writeContext: fixture.command.writeContext,
	};
	const item = itemOf(fixture, command.occurredAt);
	const outcomes = new Map<string, IngestionOutcome>();
	const activities: Array<{ readonly name: string; readonly exit: unknown }> = [];
	const issues = new Map<string, IngestionIssue>();
	const scope = { runId, userId: fixture.userId };
	const importLayer = Layer.mergeAll(
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
			getBatch: () => Effect.succeed(null),
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
		Layer.succeed(WorkflowInstance, WorkflowInstance.initial(ScriptExecutionWorkflow, runId)),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				activityExecute: (activity) =>
					Effect.map(Effect.exit(activity.execute), (exit) => {
						activities.push({ exit, name: activity.name });
						return new Workflow.Complete({ exit });
					}),
			}),
		),
	);
	const apply = runGenericImportChunk({
		...scope,
		command,
		ordinal: 0,
		batchId: "batch",
		captureId: "capture",
		inputFingerprint: "fingerprint",
		artifactOwnerExecutionId: "import-owner",
	}).pipe(
		Effect.provideContext(
			yield* Layer.build(IntegrationEventWrites.layer.pipe(Layer.provideMerge(importLayer))),
		),
	);
	const committed = Effect.flatMap(IdempotencyKeys.make, (keys) =>
		keys.importItems({
			runId,
			userId: fixture.userId,
			itemIdentities: identities.map((id) => genericImportOperationIdentity(runId, item, id)),
		}),
	);
	return { ...fixture, apply, outcomes, committed, activities };
});

const recordFixture = (memberCount: number) =>
	chunkFixture(
		undefined,
		(fixture, occurredAt): GenericImportWriteItem => ({
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
					occurredAt,
					operationId: "anchor",
					entityAlias: "subject",
					eventSchemaSlug: "anchor",
					sessionEntityAlias: "session",
					properties: { position: 0, kind: "primary", evidence: "recorded" },
				},
				...Array.from({ length: memberCount }, (_, index) => ({
					occurredAt,
					entityAlias: "subject",
					eventSchemaSlug: "member",
					sessionEntityAlias: "session",
					operationId: `member-${index}`,
					outcome: { unit: "members", recordKind: "members" },
					properties: { position: 0, amount: index, kind: "primary" },
				})),
			],
		}),
		[
			"session",
			"anchor",
			"link",
			...Array.from({ length: memberCount }, (_, index) => `member-${index}`),
		],
	);

/**
 * A standalone item: a created entity linked to the fixture's subject, found by name, and a note on
 * the subject with `properties`.
 */
const noteFixture = (properties: GenericImportWriteItem["events"][number]["properties"]) =>
	chunkFixture(
		noteSchemas,
		(fixture, occurredAt): GenericImportWriteItem => ({
			itemIndex: 0,
			recordId: "note",
			sourceLabel: "fixture",
			sourceIdentifier: "note",
			subjectEntityAlias: "created",
			events: [
				{
					occurredAt,
					properties,
					operationId: "note",
					entityAlias: "found",
					eventSchemaSlug: "note",
					outcome: { unit: "notes", recordKind: "notes" },
				},
			],
			relationships: [
				{
					properties: {},
					operationId: "link",
					targetAlias: "found",
					sourceAlias: "created",
					outcome: { unit: "links", recordKind: "links" },
					relationshipSchemaSlug: fixture.relationshipSchemaSlug,
				},
			],
			entities: [
				{
					properties: {},
					alias: "created",
					name: "Imported",
					operationId: "created",
					entitySchemaSlug: "subject",
					outcome: { unit: "subjects", recordKind: "subjects" },
				},
				{
					properties: {},
					alias: "found",
					name: "Ignored",
					operationId: "found",
					entitySchemaSlug: "subject",
					outcome: { unit: "subjects", recordKind: "subjects" },
					match: { properties: {}, name: "subject", nameNormalization: "slug" },
				},
			],
		}),
		["created", "found", "link", "note"],
	);

layer(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.provideMerge(SandboxRepository.layer, eventGroupWorkflowLayer),
			Layer.mock(CollectionsService)({}),
			Layer.mock(JobQueue)({}),
			Layer.mock(TransientValues)({}),
			Layer.mock(EntityImportWorkflowOperations)({}),
		),
		BunCrypto.layerSecureRandom,
	),
)((test) => {
	test.effect(
		"atomically imports the subject, relationships, and complete group and replays original items",
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
		testTimeout,
	);

	test.effect(
		"rolls back a grouped import's subject, relationships, events, and record items together",
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
		testTimeout,
	);

	test.effect(
		"matches an entity in the item's commit and replays the commit when its activity runs again",
		() =>
			Effect.gen(function* () {
				const fixture = yield* noteFixture({ text: "Noted" });
				yield* fixture.apply;
				expect([...fixture.outcomes.values()]).toEqual([]);
				expect((yield* fixture.committed).map(({ result }) => result).sort()).toEqual([
					"created",
					"created",
					"created",
					"unchanged",
				]);
				const database = yield* DatabaseSession;
				const written = Effect.all([
					database.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(eq(tables.entity.entitySchemaPluginId, fixture.installed.pluginId)),
					),
					database.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.entityId, fixture.subjectId)),
					),
				]);
				const [entities, events] = yield* written;
				expect(entities.map(({ name }) => name).sort()).toEqual(["Imported", "Subject"]);
				expect(events).toHaveLength(1);
				const links = yield* database.run((db) =>
					db
						.delete(tables.relationship)
						.where(eq(tables.relationship.targetEntityId, fixture.subjectId))
						.returning({ source: tables.relationship.sourceEntityId }),
				);
				const imported = entities.find(({ name }) => name === "Imported");
				assert(imported);
				expect(links).toEqual([{ source: imported.id }]);
				yield* fixture.apply;
				expect(yield* written).toEqual([entities, events]);
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.relationship)
							.where(eq(tables.relationship.targetEntityId, fixture.subjectId)),
					),
				).toEqual([]);
				const [first, replayed] = fixture.activities
					.filter(({ name }) => name === "commit-generic-import-item-0")
					.map(({ exit }) => exit);
				expect(replayed).toEqual(first);
			}),
		testTimeout,
	);

	test.effect(
		"writes nothing of an item whose event conflicts with its commit",
		() =>
			Effect.gen(function* () {
				const foreign = yield* insertManagedAsset(UserId.make("generic-import-asset-owner"));
				const fixture = yield* noteFixture({ image: foreign });
				yield* fixture.apply;
				expect(yield* fixture.committed).toEqual([]);
				expect(
					[...fixture.outcomes.values()].map(({ result, reason, operationId }) => [
						operationId,
						result,
						reason,
					]),
				).toEqual(
					["created", "found", "link", "note"].map((operationId) => [
						operationId,
						"unsuccessful",
						{ key: null, code: "asset-forbidden" },
					]),
				);
				const database = yield* DatabaseSession;
				expect(
					(yield* database.run((db) =>
						db
							.select({ name: tables.entity.name })
							.from(tables.entity)
							.where(eq(tables.entity.entitySchemaPluginId, fixture.installed.pluginId)),
					)).map(({ name }) => name),
				).toEqual(["Subject"]);
				expect(
					yield* database.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.entityId, fixture.subjectId)),
					),
				).toEqual([]);
			}),
		testTimeout,
	);
});
