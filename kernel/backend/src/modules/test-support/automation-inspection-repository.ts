import type { ContractPayload } from "@ryot-app/contract/client";
import {
	AutomationRun,
	AutomationRunAttempt,
	AutomationTrigger,
	AutomationTriggerRecipient,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import {
	automationRun as run,
	automationRunAttempt as attempt,
	automationTrigger as trigger,
	automationTriggerRecipient as recipient,
} from "#schema/tables/automations";

const triggerFilters = (input: ContractPayload<"testSupport", "listAutomationTriggers">) => [
	...(input.triggerId === undefined ? [] : [eq(trigger.id, input.triggerId)]),
	...(input.rootExecutionId === undefined
		? []
		: [eq(trigger.rootExecutionId, input.rootExecutionId)]),
	...(input.payload === undefined ? [] : [eq(trigger.payload, input.payload)]),
	...(input.actorUserId === undefined
		? []
		: [
				input.actorUserId === null
					? isNull(sql`${trigger.payload}->>'actorUserId'`)
					: eq(sql`${trigger.payload}->>'actorUserId'`, input.actorUserId),
			]),
	...(input.sourceRecord === undefined
		? []
		: [
				eq(trigger.resourceKind, input.sourceRecord.resource),
				eq(
					input.sourceRecord.resource === "provider-entity-import"
						? sql`${trigger.payload}->>'entityId'`
						: sql`coalesce(${trigger.payload}->'after'->>'id', ${trigger.payload}->'before'->>'id')`,
					input.sourceRecord.id,
				),
			]),
];

export class AutomationInspectionRepository extends Context.Service<AutomationInspectionRepository>()(
	"@ryot-app/kernel-backend/modules/test-support/automation-inspection-repository/AutomationInspectionRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const listTriggers = Effect.fn(function* (
				input: ContractPayload<"testSupport", "listAutomationTriggers">,
			) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(trigger)
						.where(and(...triggerFilters(input)))
						.orderBy(desc(trigger.createdAt), desc(trigger.id))
						.limit(100)
						.offset(input.offset ?? 0),
				);
				return yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(
						{
							id: row.id,
							payload: row.payload,
							scopeUserId: row.scopeUserId,
							blockedReason: row.blockedReason,
							createdAt: row.createdAt.toISOString(),
							occurredAt: row.occurredAt.toISOString(),
							payloadPrunedAt: row.payloadPrunedAt?.toISOString() ?? null,
							kind: {
								category: row.category,
								operation: row.operation,
								resource: row.resourceKind,
							},
							causation: {
								lane: row.lane,
								depth: row.depth,
								source: row.source,
								executionId: row.executionId,
								parentRunId: row.parentRunId,
								rootExecutionId: row.rootExecutionId,
								parentTriggerId: row.parentTriggerId,
								initiator: { id: row.initiatorId, kind: row.initiatorKind },
								...(row.importRunId === null ? {} : { importRunId: row.importRunId }),
								...(row.integrationId === null ? {} : { integrationId: row.integrationId }),
								...(row.providerExecutionId === null
									? {}
									: { providerExecutionId: row.providerExecutionId }),
							},
						},
						AutomationTrigger,
						`Invalid automation trigger ${row.id}`,
					),
				);
			});
			const listRuns = Effect.fn(function* (
				input: ContractPayload<"testSupport", "listAutomationRuns">,
			) {
				const rows = yield* session.run((db) =>
					db
						.select({ run })
						.from(run)
						.innerJoin(trigger, eq(trigger.id, run.triggerId))
						.where(
							and(
								...triggerFilters(input),
								...(input.status === undefined ? [] : [eq(run.status, input.status)]),
								...(input.hookSlug === undefined ? [] : [eq(run.hookSlug, input.hookSlug)]),
								...(input.executionUserId === undefined
									? []
									: [
											input.executionUserId === null
												? isNull(run.executionUserId)
												: eq(run.executionUserId, input.executionUserId),
										]),
							),
						)
						.orderBy(desc(run.queuedAt), desc(run.id))
						.limit(100)
						.offset(input.offset ?? 0),
				);
				return yield* Effect.forEach(
					rows,
					({
						run: {
							historyPayload: _historyPayload,
							historyPayloadTruncated: _historyPayloadTruncated,
							...row
						},
					}) =>
						decodeStoredSchema(
							{
								...row,
								queuedAt: row.queuedAt.toISOString(),
								startedAt: row.startedAt?.toISOString() ?? null,
								finishedAt: row.finishedAt?.toISOString() ?? null,
								artifactsExpireAt: row.artifactsExpireAt.toISOString(),
								nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
							},
							AutomationRun,
							`Invalid automation run ${row.id}`,
						),
				);
			});
			const listAttempts = Effect.fn(function* (
				input: ContractPayload<"testSupport", "listAutomationAttempts">,
			) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(attempt)
						.where(
							and(
								eq(attempt.runId, input.runId),
								...(input.status === undefined ? [] : [eq(attempt.status, input.status)]),
							),
						)
						.orderBy(asc(attempt.attemptNumber), asc(attempt.id))
						.limit(100)
						.offset(input.offset ?? 0),
				);
				return yield* Effect.forEach(
					rows,
					({
						historyLogs: _historyLogs,
						historyError: _historyError,
						historyArtifactsTruncated: _historyArtifactsTruncated,
						...row
					}) =>
						decodeStoredSchema(
							{
								...row,
								startedAt: row.startedAt.toISOString(),
								finishedAt: row.finishedAt?.toISOString() ?? null,
								artifactsPrunedAt: row.artifactsPrunedAt?.toISOString() ?? null,
							},
							AutomationRunAttempt,
							`Invalid automation attempt ${row.id}`,
						),
				);
			});
			const listRecipients = Effect.fn(function* (
				input: ContractPayload<"testSupport", "listAutomationRecipients">,
			) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(recipient)
						.where(
							and(
								eq(recipient.triggerId, input.triggerId),
								...(input.userId === undefined ? [] : [eq(recipient.userId, input.userId)]),
							),
						)
						.orderBy(asc(recipient.userId))
						.limit(100)
						.offset(input.offset ?? 0),
				);
				return yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(row, AutomationTriggerRecipient, "Invalid automation recipient"),
				);
			});
			return { listRuns, listTriggers, listAttempts, listRecipients };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
