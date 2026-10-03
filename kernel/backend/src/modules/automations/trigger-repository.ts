import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationTrigger,
	AutomationTriggerRecipient,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AutomationTriggerId, UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, gt, inArray, isNotNull, lte, notExists, or } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import {
	automationRun,
	automationTrigger as table,
	automationTriggerRecipient as recipientTable,
} from "#lib/infrastructure/db/schema/tables/automations";
import { DatabaseSession } from "#lib/infrastructure/db/session";

const decodeRow = (row: typeof table.$inferSelect) =>
	decodeStoredSchema(
		{
			id: row.id,
			payload: row.payload,
			scopeUserId: row.scopeUserId,
			blockedReason: row.blockedReason,
			createdAt: row.createdAt.toISOString(),
			occurredAt: row.occurredAt.toISOString(),
			payloadPrunedAt: row.payloadPrunedAt?.toISOString() ?? null,
			kind: { category: row.category, operation: row.operation, resource: row.resourceKind },
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
				...(row.eventStreamWorkId === null ? {} : { eventStreamWorkId: row.eventStreamWorkId }),
				...(row.providerExecutionId === null
					? {}
					: { providerExecutionId: row.providerExecutionId }),
			},
		},
		AutomationTrigger,
		`Invalid automation trigger ${row.id}`,
	);

const hasRuns = (db: Parameters<Parameters<DatabaseSession["Service"]["run"]>[0]>[0]) =>
	db
		.select({ id: automationRun.id })
		.from(automationRun)
		.where(eq(automationRun.triggerId, table.id));

export class AutomationTriggerRepository extends Context.Service<AutomationTriggerRepository>()(
	"AutomationTriggerRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const findById = Effect.fn(function* (id: AutomationTriggerId) {
				const [row] = yield* session.run((db) => db.select().from(table).where(eq(table.id, id)));
				return row ? yield* decodeRow(row) : null;
			});
			const insert = Effect.fn(function* (input: AutomationTrigger) {
				const value = yield* decodeStoredSchema(
					input,
					AutomationTrigger,
					"Invalid automation trigger input",
				);
				const { kind, causation, ...snapshot } = value;
				const { initiator, ...attribution } = causation;
				yield* session.run((db) =>
					db
						.insert(table)
						.values({
							...snapshot,
							...attribution,
							category: kind.category,
							operation: kind.operation,
							initiatorId: initiator.id,
							resourceKind: kind.resource,
							initiatorKind: initiator.kind,
							createdAt: DateTime.toDate(DateTime.makeUnsafe(value.createdAt)),
							occurredAt: DateTime.toDate(DateTime.makeUnsafe(value.occurredAt)),
							payloadPrunedAt:
								value.payloadPrunedAt === null
									? null
									: DateTime.toDate(DateTime.makeUnsafe(value.payloadPrunedAt)),
						})
						.onConflictDoNothing({ target: table.id }),
				);
				const stored = yield* findById(value.id);
				if (!stored || stableStringify(stored) !== stableStringify(value)) {
					return yield* new DbError({
						message: `Automation trigger identity conflict: ${value.id}`,
					});
				}
				return stored;
			});
			const listRecipients = Effect.fn(function* (triggerId: AutomationTriggerId) {
				const rows = yield* session.run((db) =>
					db
						.select()
						.from(recipientTable)
						.where(eq(recipientTable.triggerId, triggerId))
						.orderBy(asc(recipientTable.userId)),
				);
				return yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(row, AutomationTriggerRecipient, "Invalid trigger recipient"),
				);
			});
			const insertRecipients = Effect.fn(function* (
				triggerId: AutomationTriggerId,
				userIds: ReadonlyArray<UserId>,
			) {
				const rows = yield* Effect.forEach([...new Set(userIds)], (userId) =>
					decodeStoredSchema(
						{ userId, triggerId },
						AutomationTriggerRecipient,
						"Invalid trigger recipient",
					),
				);
				if (rows.length) {
					yield* session.run((db) => db.insert(recipientTable).values(rows).onConflictDoNothing());
				}
				return yield* listRecipients(triggerId);
			});
			const prunePayloads = Effect.fn(function* (input: {
				before: Date;
				prunedAt: Date;
				limit: number;
			}) {
				return yield* session.run((db) => {
					const candidates = db
						.select({ id: table.id })
						.from(table)
						.where(
							and(
								isNotNull(table.payload),
								lte(table.createdAt, input.before),
								notExists(
									db
										.select({ id: automationRun.id })
										.from(automationRun)
										.where(
											and(
												eq(automationRun.triggerId, table.id),
												or(
													inArray(automationRun.status, ["queued", "running"]),
													gt(automationRun.artifactsExpireAt, input.prunedAt),
												),
											),
										),
								),
							),
						)
						.orderBy(asc(table.createdAt), asc(table.id))
						.limit(input.limit);
					return db
						.update(table)
						.set({ payload: null, payloadPrunedAt: input.prunedAt })
						.where(inArray(table.id, candidates))
						.returning({ id: table.id });
				});
			});
			const deleteExpired = Effect.fn(function* (input: { before: Date; limit: number }) {
				return yield* session.run((db) => {
					const candidates = db
						.select({ id: table.id })
						.from(table)
						.where(and(lte(table.createdAt, input.before), notExists(hasRuns(db))))
						.orderBy(asc(table.createdAt), asc(table.id))
						.limit(input.limit);
					return db.delete(table).where(inArray(table.id, candidates)).returning({ id: table.id });
				});
			});
			return { insert, findById, deleteExpired, prunePayloads, listRecipients, insertRecipients };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
