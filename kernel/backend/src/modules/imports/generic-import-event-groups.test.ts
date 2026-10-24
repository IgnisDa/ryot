import { assert, expect, layer } from "@effect/vitest";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import type { GenericImportWriteItem } from "@ryot-app/plugin-backend-sdk/imports";
import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Layer } from "effect";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { CollectionsService } from "#modules/collections/service";
import { DefinitionRepository } from "#modules/definitions/repository";
import { definitionLookup } from "#modules/definitions/snapshot";
import { EntityImportWorkflowOperations } from "#modules/entities/providers/operations-workflow";
import {
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "#modules/events/event-groups.test-support";
import { MutationReceipts } from "#modules/mutations/receipts";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { ProcessGenericImportChunksWorkflow, writeGenericItem } from "./generic-import-workflow";
import { ingestionItemIdentity } from "./outcomes";

const recordFixture = Effect.fnUntraced(function* (memberCount: number) {
	const fixture = yield* eventGroupFixture();
	const revision = fixture.command.writeContext.pluginRevision;
	assert(revision);
	const runId = ImportRunId.make(crypto.randomUUID());
	const command = {
		...rootLifecycleCommand({
			source: "import",
			lane: "background",
			importRunId: runId,
			itemIdentity: "record",
			occurredAt: fixture.command.occurredAt,
			initiator: { kind: "user", id: fixture.userId },
			executionId: fixture.command.causation.executionId,
			accountGeneration: fixture.command.accountGeneration,
		}),
		writeContext: fixture.command.writeContext,
		accountGeneration: fixture.command.accountGeneration,
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
	const definitionRows = yield* (yield* DefinitionRepository).getSnapshotForContext(
		{ pluginId: revision.id, pluginRevisionId: revision.revisionId },
		fixture.userId,
	);
	const apply = writeGenericItem(
		item,
		fixture.userId,
		0,
		definitionLookup(definitionRows),
		command,
		revision,
	).pipe(
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(ProcessGenericImportChunksWorkflow, runId),
		),
	);
	const receiptIdentities = [
		"session",
		"anchor",
		"link",
		...Array.from({ length: memberCount }, (_, index) => `member-${index}`),
	].map((id) => ingestionItemIdentity(runId, id));
	return { ...fixture, runId, apply, command, receiptIdentities };
});

layer(
	Layer.mergeAll(
		eventGroupWorkflowLayer,
		Layer.mock(CollectionsService)({}),
		Layer.mock(EntityImportWorkflowOperations)({}),
	),
)((test) => {
	test.effect(
		"atomically imports the subject, relationships, and complete group and replays original receipts after interruption",
		() =>
			Effect.gen(function* () {
				const fixture = yield* recordFixture(101);
				const interrupted = yield* Effect.exit(
					Effect.gen(function* () {
						expect((yield* fixture.apply)._tag).toBe("ready");
						return yield* Effect.interrupt;
					}),
				);
				assert(Exit.isFailure(interrupted));
				expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
				const replay = yield* fixture.apply;
				assert(replay._tag === "ready");
				expect(replay.events).toEqual([]);
				const committed = yield* (yield* MutationReceipts.make).getCommittedItems({
					userId: fixture.userId,
					itemIdentities: fixture.receiptIdentities,
					accountGeneration: fixture.command.accountGeneration,
					rootExecutionId: fixture.command.causation.rootExecutionId,
				});
				expect(committed).toHaveLength(104);
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
		"rolls back a constrained import's subject, relationships, events, and record receipts together",
		() =>
			Effect.gen(function* () {
				const fixture = yield* recordFixture(0);
				expect((yield* fixture.apply)._tag).toBe("failed");
				const committed = yield* (yield* MutationReceipts.make).getCommittedItems({
					userId: fixture.userId,
					itemIdentities: fixture.receiptIdentities,
					accountGeneration: fixture.command.accountGeneration,
					rootExecutionId: fixture.command.causation.rootExecutionId,
				});
				expect(committed).toEqual([]);
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
