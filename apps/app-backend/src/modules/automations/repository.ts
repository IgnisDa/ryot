import {
	AutomationRuleMetadata,
	type AutomationOperation,
	type AutomationRuleMetadata as AutomationRuleMetadataValue,
	type SubscriptionRunSourceKind,
	type SubscriptionRunSkipReason,
	type SubscriptionRunTiming,
} from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	SandboxScriptId,
	SignalId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
	type EntitySchemaSlug,
	type EventSchemaSlug,
	type RelationshipSchemaSlug,
} from "@ryot/contract/schema/brands";
import { decodeStoredSchema } from "@ryot/contract/schema/core";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { DateTime, Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

type NotificationSubscriptionStateRow = typeof schema.notificationSubscriptionState.$inferSelect;
type SubscriptionRunRow = typeof schema.subscriptionRun.$inferSelect;

export type AutomationRuleTarget =
	| { kind: "event_schema"; id: EventSchemaSlug }
	| { kind: "entity_schema"; id: EntitySchemaSlug }
	| { kind: "signal_schema"; id: SignalSchemaSlug }
	| { kind: "relationship_schema"; id: RelationshipSchemaSlug };

export type StoredNotificationSubscription = {
	userId: UserId;
	createdAt: string;
	updatedAt: string;
	isActive: boolean;
	id: AutomationRuleId;
	signalSchemaSlug: SignalSchemaSlug;
	metadata: AutomationRuleMetadataValue | null;
};

export type InsertNotificationSubscriptionInput = Pick<
	StoredNotificationSubscription,
	"isActive" | "metadata" | "signalSchemaSlug" | "userId"
>;

export type InsertSubscriptionRunInput = {
	ruleName: string;
	occurrenceId: string;
	id: SubscriptionRunId;
	recordId: string | null;
	ruleId: AutomationRuleId;
	signalId: SignalId | null;
	operation: AutomationOperation;
	executionUserId: UserId | null;
	sandboxScriptId: SandboxScriptId;
	sourceKind: SubscriptionRunSourceKind;
	ruleMetadata: AutomationRuleMetadataValue | null;
};

export type FinishSubscriptionRunInput = {
	id: SubscriptionRunId;
	status: "failed" | "succeeded";
	timing: SubscriptionRunTiming | null;
	logs: AutomationRuleMetadataValue | null;
	sandboxError: AutomationRuleMetadataValue | null;
	returnedValue: AutomationRuleMetadataValue | null;
};

const toStoredNotificationSubscription = Effect.fn(function* (
	row: NotificationSubscriptionStateRow,
) {
	const metadata =
		row.metadata === null
			? null
			: yield* decodeStoredSchema(
					row.metadata,
					AutomationRuleMetadata,
					`Invalid metadata for notification subscription ${row.id}`,
				);
	return {
		metadata,
		isActive: row.isActive,
		userId: UserId.make(row.userId),
		id: AutomationRuleId.make(row.id),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		signalSchemaSlug: SignalSchemaSlug.make(row.signalSchemaSlug),
	};
});

const toStoredRun = (row: SubscriptionRunRow) => ({
	...row,
	queuedAt: row.queuedAt.toISOString(),
	id: SubscriptionRunId.make(row.id),
	ruleId: AutomationRuleId.make(row.ruleId),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
	scriptUpdatedAt: row.scriptUpdatedAt?.toISOString() ?? null,
	sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
	signalId: row.signalId ? SignalId.make(row.signalId) : null,
	executionUserId: row.executionUserId ? UserId.make(row.executionUserId) : null,
});

export type StoredSubscriptionRun = ReturnType<typeof toStoredRun>;

export class AutomationsRepository extends Effect.Service<AutomationsRepository>()(
	"AutomationsRepository",
	{
		sync: () => {
			const listNotificationSubscriptions = Effect.fn(
				"AutomationsRepository.listNotificationSubscriptions",
			)(function* (userId: UserId) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationSubscriptionState)
						.where(eq(schema.notificationSubscriptionState.userId, userId))
						.orderBy(
							asc(schema.notificationSubscriptionState.signalSchemaSlug),
							asc(schema.notificationSubscriptionState.id),
						),
				);
				return yield* Effect.all(rows.map(toStoredNotificationSubscription));
			});

			const listActiveNotificationSubscriptions = Effect.fn(
				"AutomationsRepository.listActiveNotificationSubscriptions",
			)(function* (input: { userId: UserId; signalSchemaSlug: SignalSchemaSlug }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationSubscriptionState)
						.where(
							and(
								eq(schema.notificationSubscriptionState.userId, input.userId),
								eq(schema.notificationSubscriptionState.isActive, true),
								eq(schema.notificationSubscriptionState.signalSchemaSlug, input.signalSchemaSlug),
							),
						)
						.orderBy(asc(schema.notificationSubscriptionState.id)),
				);
				return yield* Effect.all(rows.map(toStoredNotificationSubscription));
			});

			const findNotificationSubscription = Effect.fn(
				"AutomationsRepository.findNotificationSubscription",
			)(function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationSubscriptionState)
						.where(
							and(
								eq(schema.notificationSubscriptionState.id, input.ruleId),
								eq(schema.notificationSubscriptionState.userId, input.userId),
							),
						)
						.limit(1),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const lockActiveNotificationSubscription = Effect.fn(
				"AutomationsRepository.lockActiveNotificationSubscription",
			)(function* (ruleId: AutomationRuleId) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.notificationSubscriptionState)
						.where(
							and(
								eq(schema.notificationSubscriptionState.id, ruleId),
								eq(schema.notificationSubscriptionState.isActive, true),
							),
						)
						.limit(1)
						.for("update"),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const insertNotificationSubscription = Effect.fn(
				"AutomationsRepository.insertNotificationSubscription",
			)(function* (input: InsertNotificationSubscriptionInput) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.notificationSubscriptionState)
						.values(input)
						.onConflictDoNothing()
						.returning(),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const setNotificationSubscriptionActive = Effect.fn(
				"AutomationsRepository.setNotificationSubscriptionActive",
			)(function* (input: { userId: UserId; ruleId: AutomationRuleId; isActive: boolean }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.notificationSubscriptionState)
						.set({ isActive: input.isActive })
						.where(
							and(
								eq(schema.notificationSubscriptionState.id, input.ruleId),
								eq(schema.notificationSubscriptionState.userId, input.userId),
							),
						)
						.returning(),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const deleteNotificationSubscription = Effect.fn(
				"AutomationsRepository.deleteNotificationSubscription",
			)(function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.delete(schema.notificationSubscriptionState)
						.where(
							and(
								eq(schema.notificationSubscriptionState.id, input.ruleId),
								eq(schema.notificationSubscriptionState.userId, input.userId),
							),
						)
						.returning({ id: schema.notificationSubscriptionState.id }),
				);
				return row ? { id: AutomationRuleId.make(row.id) } : null;
			});

			const countByUser = Effect.fn("AutomationsRepository.countByUser")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ count: count() })
						.from(schema.notificationSubscriptionState)
						.where(eq(schema.notificationSubscriptionState.userId, userId)),
				);
				return row?.count ?? 0;
			});

			const isUserEnabled = Effect.fn("AutomationsRepository.isUserEnabled")(function* (
				userId: UserId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({ id: schema.user.id })
						.from(schema.user)
						.where(and(eq(schema.user.id, userId), isNull(schema.user.disabledAt)))
						.limit(1),
				);
				return row !== undefined;
			});

			const findScriptExecution = Effect.fn("AutomationsRepository.findScriptExecution")(function* (
				scriptId: SandboxScriptId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select({
							userId: schema.sandboxScript.userId,
							updatedAt: schema.sandboxScript.updatedAt,
							pluginSlug: schema.sandboxScript.pluginSlug,
							contentHash: schema.sandboxScript.contentHash,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				return row
					? {
							updatedAt: row.updatedAt.toISOString(),
							userId: row.userId ? UserId.make(row.userId) : null,
							isBuiltin:
								row.pluginSlug !== null || (row.userId === null && row.contentHash !== null),
						}
					: null;
			});

			const insertRun = Effect.fn("AutomationsRepository.insertRun")(function* (
				input: InsertSubscriptionRunInput,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.insert(schema.subscriptionRun)
						.values(input)
						.onConflictDoNothing({ target: schema.subscriptionRun.id })
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const findRunById = Effect.fn("AutomationsRepository.findRunById")(function* (
				id: SubscriptionRunId,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.subscriptionRun)
						.where(eq(schema.subscriptionRun.id, id))
						.limit(1),
				);
				return row ? toStoredRun(row) : null;
			});

			const markRunRunning = Effect.fn("AutomationsRepository.markRunRunning")(function* (input: {
				id: SubscriptionRunId;
				scriptUpdatedAt: Date;
			}) {
				const db = yield* CurrentDb;
				const startedAt = yield* DateTime.nowAsDate;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.subscriptionRun)
						.set({ startedAt, status: "running", scriptUpdatedAt: input.scriptUpdatedAt })
						.where(
							and(
								eq(schema.subscriptionRun.id, input.id),
								eq(schema.subscriptionRun.status, "queued"),
							),
						)
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const finishRun = Effect.fn("AutomationsRepository.finishRun")(function* (
				input: FinishSubscriptionRunInput,
			) {
				const db = yield* CurrentDb;
				const finishedAt = yield* DateTime.nowAsDate;
				const { id, ...outcome } = input;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.subscriptionRun)
						.set({ ...outcome, finishedAt })
						.where(
							and(eq(schema.subscriptionRun.id, id), eq(schema.subscriptionRun.status, "running")),
						)
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const skipRun = Effect.fn("AutomationsRepository.skipRun")(function* (input: {
				id: SubscriptionRunId;
				reason: SubscriptionRunSkipReason;
			}) {
				const db = yield* CurrentDb;
				const now = yield* DateTime.nowAsDate;
				const [row] = yield* dbEffect(() =>
					db
						.update(schema.subscriptionRun)
						.set({ status: "skipped", startedAt: now, finishedAt: now, skipReason: input.reason })
						.where(
							and(
								eq(schema.subscriptionRun.id, input.id),
								eq(schema.subscriptionRun.status, "queued"),
							),
						)
						.returning(),
				);
				return row ? toStoredRun(row) : null;
			});

			const listRunsByRuleId = Effect.fn("AutomationsRepository.listRunsByRuleId")(
				function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
					const db = yield* CurrentDb;
					const rows = yield* dbEffect(() =>
						db
							.select()
							.from(schema.subscriptionRun)
							.where(
								and(
									eq(schema.subscriptionRun.ruleId, input.ruleId),
									eq(schema.subscriptionRun.executionUserId, input.userId),
								),
							)
							.orderBy(asc(schema.subscriptionRun.queuedAt), asc(schema.subscriptionRun.id)),
					);
					return rows.map(toStoredRun);
				},
			);

			const listRunsByExecutionUserId = Effect.fn(
				"AutomationsRepository.listRunsByExecutionUserId",
			)(function* (input: { executionUserId: UserId; signalId?: SignalId | undefined }) {
				const db = yield* CurrentDb;
				const rows = yield* dbEffect(() =>
					db
						.select({ id: schema.subscriptionRun.id, status: schema.subscriptionRun.status })
						.from(schema.subscriptionRun)
						.where(
							and(
								eq(schema.subscriptionRun.executionUserId, input.executionUserId),
								input.signalId ? eq(schema.subscriptionRun.signalId, input.signalId) : undefined,
							),
						)
						.orderBy(asc(schema.subscriptionRun.queuedAt), asc(schema.subscriptionRun.id)),
				);
				return rows.map((row) => ({ id: SubscriptionRunId.make(row.id), status: row.status }));
			});

			return {
				skipRun,
				finishRun,
				insertRun,
				countByUser,
				findRunById,
				isUserEnabled,
				markRunRunning,
				listRunsByRuleId,
				findScriptExecution,
				listRunsByExecutionUserId,
				findNotificationSubscription,
				listNotificationSubscriptions,
				insertNotificationSubscription,
				deleteNotificationSubscription,
				setNotificationSubscriptionActive,
				lockActiveNotificationSubscription,
				listActiveNotificationSubscriptions,
			};
		},
	},
) {}
