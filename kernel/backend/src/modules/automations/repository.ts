import type { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRuleMetadata,
	type AutomationRuleMetadata as AutomationRuleMetadataValue,
} from "@ryot-app/contract/modules/automations/schemas";
import {
	NotificationSubscriptionId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

type NotificationSubscriptionRow = typeof schema.notificationSubscription.$inferSelect;

export type StoredNotificationSubscription = {
	userId: UserId;
	createdAt: string;
	updatedAt: string;
	isActive: boolean;
	id: NotificationSubscriptionId;
	signalSchemaSlug: SignalSchemaSlug;
	signalSchemaPluginId: string | null;
	metadata: AutomationRuleMetadataValue | null;
};

export type InsertNotificationSubscriptionInput = Pick<
	StoredNotificationSubscription,
	"isActive" | "metadata" | "signalSchemaPluginId" | "signalSchemaSlug" | "userId"
>;

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
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		id: NotificationSubscriptionId.make(row.id),
		signalSchemaPluginId: row.signalSchemaPluginId,
		signalSchemaSlug: SignalSchemaSlug.make(row.signalSchemaSlug),
	};
});

const signalSchemaPluginWhere = (pluginId: string | null) =>
	pluginId === null
		? isNull(schema.notificationSubscription.signalSchemaPluginId)
		: eq(schema.notificationSubscription.signalSchemaPluginId, pluginId);

export class AutomationsRepository extends Context.Service<AutomationsRepository>()(
	"AutomationsRepository",
	{
		make: Effect.sync(() => {
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
			)(function* (input: { userId: UserId; ruleId: NotificationSubscriptionId }) {
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
			)(function* (input: {
				userId: UserId;
				ruleId: NotificationSubscriptionId;
				isActive: boolean;
			}) {
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
			)(function* (input: { userId: UserId; ruleId: NotificationSubscriptionId }) {
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
				return row ? { id: NotificationSubscriptionId.make(row.id) } : null;
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

			return {
				countByUser,
				findNotificationSubscription,
				insertNotificationSubscription,
				deleteNotificationSubscription,
				restoreNotificationSubscription,
				setNotificationSubscriptionActive,
				listActiveNotificationSubscriptions,
				listNotificationSubscriptionsForBackup,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
