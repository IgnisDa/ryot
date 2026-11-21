import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import type { DbError } from "@ryot-app/contract/errors";
import { EntityBadRequest } from "@ryot-app/contract/modules/entities/schemas";
import type {
	IngestionIssue,
	IngestionOutcome,
} from "@ryot-app/contract/modules/imports/ingestion";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntitySchemaSlug,
	ImportRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import type { GenericImportWriteItem } from "@ryot-app/plugin-backend-sdk/imports";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { ChangeSets } from "#modules/changes/service";
import { CollectionsRepository } from "#modules/collections/repository";
import { CollectionsService } from "#modules/collections/service";
import { RelationshipSchemaReader } from "#modules/definitions/relationship-schemas";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import {
	type RecordedStatement,
	StatementLog,
} from "#modules/entities/statement-recording.test-support";
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

/**
 * A standalone item creating one entity and adding it to " Shelf ", which does not exist, and to the
 * user's existing collections "Existing" and "Strict", the last of which requires a member field.
 */
const membershipFixture = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.transaction(
		Effect.flatMap(DefinitionRepository, (definitions) =>
			definitions.replaceKernelDefinitions(kernelDefinitionSource()),
		),
	);
	const fixture = yield* chunkFixture(
		undefined,
		(): GenericImportWriteItem => ({
			events: [],
			itemIndex: 0,
			relationships: [],
			recordId: "member",
			sourceLabel: "fixture",
			sourceIdentifier: "member",
			subjectEntityAlias: "created",
			entities: [
				{
					properties: {},
					alias: "created",
					name: "Imported",
					operationId: "created",
					entitySchemaSlug: "subject",
					outcome: { unit: "subjects", recordKind: "subjects" },
				},
			],
			collectionMemberships: ["Shelf", "Existing", "Strict"].map((name) => ({
				entityAlias: "created",
				operationId: name.toLowerCase(),
				collectionName: name === "Shelf" ? " Shelf " : name,
				outcome: { unit: "memberships", recordKind: "memberships" },
			})),
		}),
		["created", "shelf", "existing", "strict"],
	);
	yield* session.run((db) =>
		db.insert(tables.entity).values(
			[
				{ fields: [], name: "Existing" },
				{ name: "Strict", fields: [{ key: "note", type: "text", label: "Note", required: true }] },
			].map(({ name, fields }) => ({
				name,
				userId: fixture.userId,
				entitySchemaSlug: "collection",
				properties: { membershipFields: fields },
			})),
		),
	);
	const collections = Effect.flatMap(DatabaseSession, (database) =>
		database.run((db) =>
			db
				.select({ id: tables.entity.id, name: tables.entity.name })
				.from(tables.entity)
				.where(
					and(
						eq(tables.entity.userId, fixture.userId),
						eq(tables.entity.entitySchemaSlug, "collection"),
					),
				),
		),
	);
	return { ...fixture, collections };
});

layer(
	Layer.provideMerge(
		Layer.mergeAll(
			Layer.provideMerge(
				CollectionsService.layer.pipe(
					Layer.provide(Layer.merge(CollectionsRepository.layer, RelationshipSchemaReader.layer)),
				),
				Layer.provideMerge(SandboxRepository.layer, eventGroupWorkflowLayer),
			),
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

	test.effect(
		"commits an item's collection memberships with the item, taking each authority lock once, and leaves out one its collection rejects",
		() =>
			Effect.gen(function* () {
				const fixture = yield* membershipFixture;
				const log = yield* StatementLog;
				const earlier = (yield* log.transactions).length;
				yield* fixture.apply;
				const commits = (yield* log.transactions)
					.slice(earlier)
					.filter((statements) =>
						statements.some(({ statement }) => statement.startsWith('insert into "relationship"')),
					);
				expect(commits).toHaveLength(1);
				const [commit] = commits;
				assert(commit);
				const count = (matches: (recorded: RecordedStatement) => boolean) =>
					commit.filter(matches).length;
				expect(
					["ryot-plugin-ingestion", `ryot-plugin-ingestion:user:${fixture.userId}`].map((key) =>
						count(
							({ params, statement }) =>
								statement.includes("pg_advisory_xact_lock_shared") && params.includes(key),
						),
					),
				).toEqual([1, 1]);
				expect(
					count(
						({ params, statement }) =>
							statement === "select pg_advisory_xact_lock_shared(hashtext($1))" &&
							params[0] === `plugin-config:${fixture.installed.pluginId}`,
					),
				).toBe(1);
				expect(
					[
						'from "plugin_revision" inner join "plugin"',
						'for share of "plugin_installation"',
						'from "user" where "user"."id" = $1 limit $2 for share',
						'from "sandbox_script" left join "kernel_script"',
						'from "plugin" inner join "plugin_revision"',
					].map((fragment) => count(({ statement }) => statement.includes(fragment))),
				).toEqual([1, 1, 1, 1, 0]);
				yield* fixture.apply;
				expect(
					[...fixture.outcomes.values()].map(({ result, reason, operationId }) => [
						operationId,
						result,
						reason,
					]),
				).toEqual([["strict", "unsuccessful", { key: null, code: "membership-event-failed" }]]);
				expect((yield* fixture.committed).map(({ result }) => result)).toEqual([
					"created",
					"created",
					"created",
				]);
				const collections = yield* fixture.collections;
				expect(collections.map(({ name }) => name).sort()).toEqual(["Existing", "Shelf", "Strict"]);
				const database = yield* DatabaseSession;
				const [imported] = yield* database.run((db) =>
					db
						.select({ id: tables.entity.id })
						.from(tables.entity)
						.where(
							and(
								eq(tables.entity.name, "Imported"),
								eq(tables.entity.entitySchemaPluginId, fixture.installed.pluginId),
							),
						),
				);
				assert(imported);
				const memberOf = yield* database.run((db) =>
					db
						.select({ target: tables.relationship.targetEntityId })
						.from(tables.relationship)
						.where(
							and(
								eq(tables.relationship.sourceEntityId, imported.id),
								eq(tables.relationship.relationshipSchemaSlug, "member-of"),
							),
						),
				);
				const joined = collections
					.filter(({ name }) => name !== "Strict")
					.map(({ id }) => id)
					.sort();
				expect(memberOf.map(({ target }) => target).sort()).toEqual(joined);
				const added = yield* database.run((db) =>
					db
						.select({ entityId: tables.event.entityId, properties: tables.event.properties })
						.from(tables.event)
						.where(eq(tables.event.eventSchemaSlug, "add-entity-to-collection")),
				);
				expect(added.map(({ entityId }) => entityId).sort()).toEqual(joined);
				expect(added[0]?.properties).toMatchObject({
					entityId: imported.id,
					entitySchemaSlug: "subject",
				});
			}),
		testTimeout,
	);

	test.effect(
		"rejects a commit whose installation was revoked or account disabled after preparation",
		() =>
			Effect.gen(function* () {
				const fixture = yield* eventGroupFixture(undefined);
				const session = yield* DatabaseSession;
				const changeSets = yield* ChangeSets;
				const owned = definitionOwner(fixture.installed.pluginId);
				const installation = and(
					eq(tables.pluginInstallation.pluginId, fixture.installed.pluginId),
					eq(tables.pluginInstallation.userId, fixture.userId),
				);
				const commitRevoking = (revoke: Effect.Effect<unknown, DbError>, name: string) => {
					let loads = 0;
					return Effect.exit(
						changeSets.commitOnce(
							{
								userId: fixture.userId,
								entity: {
									name,
									properties: {},
									target: { kind: "create" },
									entitySchema: { owner: owned, slug: EntitySchemaSlug.make("subject") },
								},
							},
							{ ...fixture.command, itemIdentity: name },
							{
								record: () => Effect.succeed("recorded"),
								load: Effect.suspend(() =>
									++loads === 2
										? session.detached(revoke).pipe(Effect.as(null))
										: Effect.succeed(null),
								),
							},
						),
					);
				};
				const written = (name: string) =>
					session.run((db) =>
						db
							.select({ id: tables.entity.id })
							.from(tables.entity)
							.where(eq(tables.entity.name, name)),
					);
				const conflict = new EntityBadRequest({ reason: { code: "mutation-conflict" } });
				assertExitFails(
					yield* commitRevoking(
						session.run((db) =>
							db
								.update(tables.pluginInstallation)
								.set({ uninstalledAt: new Date() })
								.where(installation),
						),
						"Uninstalled",
					),
					conflict,
				);
				expect(yield* written("Uninstalled")).toEqual([]);
				yield* session.run((db) =>
					db.update(tables.pluginInstallation).set({ uninstalledAt: null }).where(installation),
				);
				assertExitFails(
					yield* commitRevoking(
						session.run((db) =>
							db
								.update(tables.user)
								.set({ disabledAt: new Date() })
								.where(eq(tables.user.id, fixture.userId)),
						),
						"Disabled",
					),
					conflict,
				);
				expect(yield* written("Disabled")).toEqual([]);
			}),
		testTimeout,
	);
});
