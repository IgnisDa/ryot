import type { DbError } from "@ryot-app/contract/errors";
import {
	AutomationOccurrence,
	AutomationRuleMetadata,
	type AutomationOccurrence as AutomationOccurrenceValue,
	type AutomationRuleMetadata as AutomationRuleMetadataValue,
	type SubscriptionRunSkipReason,
	type SubscriptionRunTiming,
} from "@ryot-app/contract/modules/automations/schemas";
import type { AutomationOccurrenceId, SignalId } from "@ryot-app/contract/schema/brands";
import {
	AutomationRuleId,
	SandboxScriptId,
	SignalSchemaSlug,
	SubscriptionRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { AutomationRuleTarget as PluginAutomationRuleTarget } from "#modules/plugins/runtime-resolver";

type NotificationSubscriptionRow = typeof schema.notificationSubscription.$inferSelect;
type SubscriptionRunRow = typeof schema.subscriptionRun.$inferSelect;
type AutomationOccurrenceRow = typeof schema.automationOccurrence.$inferSelect;

export type AutomationRuleTarget = PluginAutomationRuleTarget;

export type InsertAutomationOccurrenceInput = AutomationOccurrenceValue;

export type StoredNotificationSubscription = {
	userId: UserId;
	createdAt: string;
	updatedAt: string;
	isActive: boolean;
	id: AutomationRuleId;
	signalSchemaSlug: SignalSchemaSlug;
	signalSchemaPluginId: string | null;
	metadata: AutomationRuleMetadataValue | null;
};

export type InsertNotificationSubscriptionInput = Pick<
	StoredNotificationSubscription,
	"isActive" | "metadata" | "signalSchemaPluginId" | "signalSchemaSlug" | "userId"
>;

export type InsertSubscriptionRunInput = {
	ruleName: string;
	occurrenceId: string;
	id: SubscriptionRunId;
	ruleId: AutomationRuleId;
	executionUserId: UserId | null;
	sandboxScriptId: SandboxScriptId;
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

const toStoredNotificationSubscription: (
	row: NotificationSubscriptionRow,
) => Effect.Effect<StoredNotificationSubscription, DbError> = Effect.fn(function* (
	row: NotificationSubscriptionRow,
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
		signalSchemaPluginId: row.signalSchemaPluginId,
		signalSchemaSlug: SignalSchemaSlug.make(row.signalSchemaSlug),
	};
});

const signalSchemaPluginWhere = (pluginId: string | null) =>
	pluginId === null
		? isNull(schema.notificationSubscription.signalSchemaPluginId)
		: eq(schema.notificationSubscription.signalSchemaPluginId, pluginId);

const toStoredRun = (row: SubscriptionRunRow) => ({
	...row,
	id: SubscriptionRunId.make(row.id),
	queuedAt: row.queuedAt.toISOString(),
	ruleId: AutomationRuleId.make(row.ruleId),
	startedAt: row.startedAt?.toISOString() ?? null,
	finishedAt: row.finishedAt?.toISOString() ?? null,
	sandboxScriptId: SandboxScriptId.make(row.sandboxScriptId),
	scriptUpdatedAt: row.scriptUpdatedAt?.toISOString() ?? null,
	executionUserId: row.executionUserId ? UserId.make(row.executionUserId) : null,
});

export type StoredSubscriptionRun = ReturnType<typeof toStoredRun>;

const toStoredOccurrence: (
	row: AutomationOccurrenceRow,
) => Effect.Effect<AutomationOccurrenceValue, DbError> = Effect.fn(function* (
	row: AutomationOccurrenceRow,
) {
	return yield* decodeStoredSchema(
		{
			id: row.id,
			origin: row.origin,
			source: row.source,
			userId: row.userId,
			recordId: row.recordId,
			signalId: row.signalId,
			operation: row.operation,
			sourceKind: row.sourceKind,
			population: row.population,
			occurredAt: row.occurredAt.toISOString(),
		},
		AutomationOccurrence,
		`Invalid automation occurrence ${row.id}`,
	);
});

export class AutomationsRepository extends Context.Service<AutomationsRepository>()(
	"AutomationsRepository",
	{
		make: Effect.sync(() => {
			const insertOccurrence = Effect.fn("AutomationsRepository.insertOccurrence")(function* (
				input: InsertAutomationOccurrenceInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.automationOccurrence)
						.values({
							...input,
							occurredAt: DateTime.toDate(DateTime.makeUnsafe(input.occurredAt)),
						})
						.onConflictDoNothing({ target: schema.automationOccurrence.id })
						.returning(),
				);
				return row ? yield* toStoredOccurrence(row) : null;
			});

			const findOccurrence = Effect.fn("AutomationsRepository.findOccurrence")(function* (
				id: AutomationOccurrenceId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.automationOccurrence)
						.where(eq(schema.automationOccurrence.id, id))
						.limit(1),
				);
				return row ? yield* toStoredOccurrence(row) : null;
			});

			const listNotificationSubscriptionsForBackup = Effect.fn(
				"AutomationsRepository.listNotificationSubscriptionsForBackup",
			)(function* (userId: UserId) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.notificationSubscription)
						.where(eq(schema.notificationSubscription.userId, userId))
						.orderBy(asc(schema.notificationSubscription.id)),
				);
				return yield* Effect.forEach(rows, toStoredNotificationSubscription);
			});

			const restoreNotificationSubscription = Effect.fn(
				"AutomationsRepository.restoreNotificationSubscription",
			)(function* (input: {
				userId: UserId;
				isActive: boolean;
				signalSchemaSlug: SignalSchemaSlug;
				signalSchemaPluginId: string | null;
				metadata: AutomationRuleMetadataValue | null;
			}) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.notificationSubscription)
						.set({
							isActive: input.isActive,
							metadata: input.metadata,
							signalSchemaPluginId: input.signalSchemaPluginId,
						})
						.where(
							and(
								eq(schema.notificationSubscription.userId, input.userId),
								eq(schema.notificationSubscription.signalSchemaSlug, input.signalSchemaSlug),
								signalSchemaPluginWhere(input.signalSchemaPluginId),
							),
						)
						.returning(),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const listActiveNotificationSubscriptions = Effect.fn(
				"AutomationsRepository.listActiveNotificationSubscriptions",
			)(function* (input: {
				userId: UserId;
				signalSchemaSlug: SignalSchemaSlug;
				signalSchemaPluginId: string | null;
			}) {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.notificationSubscription)
						.where(
							and(
								eq(schema.notificationSubscription.userId, input.userId),
								eq(schema.notificationSubscription.isActive, true),
								eq(schema.notificationSubscription.signalSchemaSlug, input.signalSchemaSlug),
								signalSchemaPluginWhere(input.signalSchemaPluginId),
							),
						)
						.orderBy(asc(schema.notificationSubscription.id)),
				);
				return yield* Effect.forEach(rows, toStoredNotificationSubscription);
			});

			const findNotificationSubscription = Effect.fn(
				"AutomationsRepository.findNotificationSubscription",
			)(function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.notificationSubscription)
						.where(
							and(
								eq(schema.notificationSubscription.id, input.ruleId),
								eq(schema.notificationSubscription.userId, input.userId),
							),
						)
						.limit(1),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const lockActiveNotificationSubscription = Effect.fn(
				"AutomationsRepository.lockActiveNotificationSubscription",
			)(function* (ruleId: AutomationRuleId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.notificationSubscription)
						.where(
							and(
								eq(schema.notificationSubscription.id, ruleId),
								eq(schema.notificationSubscription.isActive, true),
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.insert(schema.notificationSubscription)
						.values(input)
						.onConflictDoNothing()
						.returning(),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const setNotificationSubscriptionActive = Effect.fn(
				"AutomationsRepository.setNotificationSubscriptionActive",
			)(function* (input: { userId: UserId; ruleId: AutomationRuleId; isActive: boolean }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.notificationSubscription)
						.set({ isActive: input.isActive })
						.where(
							and(
								eq(schema.notificationSubscription.id, input.ruleId),
								eq(schema.notificationSubscription.userId, input.userId),
							),
						)
						.returning(),
				);
				return row ? yield* toStoredNotificationSubscription(row) : null;
			});

			const deleteNotificationSubscription = Effect.fn(
				"AutomationsRepository.deleteNotificationSubscription",
			)(function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.delete(schema.notificationSubscription)
						.where(
							and(
								eq(schema.notificationSubscription.id, input.ruleId),
								eq(schema.notificationSubscription.userId, input.userId),
							),
						)
						.returning({ id: schema.notificationSubscription.id }),
				);
				return row ? { id: AutomationRuleId.make(row.id) } : null;
			});

			const countByUser = Effect.fn("AutomationsRepository.countByUser")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ count: count() })
						.from(schema.notificationSubscription)
						.where(eq(schema.notificationSubscription.userId, userId)),
				);
				return row?.count ?? 0;
			});

			const isUserEnabled = Effect.fn("AutomationsRepository.isUserEnabled")(function* (
				userId: UserId,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ updatedAt: schema.sandboxScript.updatedAt })
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				return row ? { updatedAt: row.updatedAt.toISOString() } : null;
			});

			const insertRun = Effect.fn("AutomationsRepository.insertRun")(function* (
				input: InsertSubscriptionRunInput,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const startedAt = yield* DateTime.nowAsDate;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const finishedAt = yield* DateTime.nowAsDate;
				const { id, ...outcome } = input;
				const [row] = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const now = yield* DateTime.nowAsDate;
				const [row] = yield* mapDatabaseErrors(
					db
						.update(schema.subscriptionRun)
						.set({ startedAt: now, finishedAt: now, status: "skipped", skipReason: input.reason })
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
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
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
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({ id: schema.subscriptionRun.id, status: schema.subscriptionRun.status })
						.from(schema.subscriptionRun)
						.innerJoin(
							schema.automationOccurrence,
							eq(schema.subscriptionRun.occurrenceId, schema.automationOccurrence.id),
						)
						.where(
							and(
								eq(schema.subscriptionRun.executionUserId, input.executionUserId),
								input.signalId
									? eq(schema.automationOccurrence.signalId, input.signalId)
									: undefined,
							),
						)
						.orderBy(asc(schema.subscriptionRun.queuedAt), asc(schema.subscriptionRun.id)),
				);
				return rows.map((row) => ({ status: row.status, id: SubscriptionRunId.make(row.id) }));
			});

			return {
				skipRun,
				finishRun,
				insertRun,
				countByUser,
				findRunById,
				isUserEnabled,
				findOccurrence,
				markRunRunning,
				insertOccurrence,
				listRunsByRuleId,
				findScriptExecution,
				listRunsByExecutionUserId,
				findNotificationSubscription,
				insertNotificationSubscription,
				deleteNotificationSubscription,
				restoreNotificationSubscription,
				setNotificationSubscriptionActive,
				lockActiveNotificationSubscription,
				listActiveNotificationSubscriptions,
				listNotificationSubscriptionsForBackup,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
