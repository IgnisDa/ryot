import type {
	NotificationChannelOutcome,
	NotificationDeliveryReason,
	NotificationOutcome,
	NotificationRequest,
} from "@ryot-app/contract/modules/notifications/delivery";
import type { NotificationChannelSpecifics } from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, snakeCase, text, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const notificationChannel = snakeCase.table(
	"notification_channel",
	{
		updatedAt: updatedAtColumn(),
		description: text().notNull(),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamptz().defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		channelSpecifics: jsonb("platform_specifics").notNull().$type<NotificationChannelSpecifics>(),
		channel: text("platform")
			.notNull()
			.$type<NotificationChannelKind>()
			.generatedAlwaysAs(sql`platform_specifics->>'kind'`),
	},
	(table) => [
		index("notification_channel_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("notification_channel_user_id_is_disabled_idx").on(table.userId, table.isDisabled),
	],
);

export const notification = snakeCase.table(
	"notification",
	{
		sourceRunId: text(),
		id: text().primaryKey(),
		settledAt: timestamptz(),
		sourceKey: text().notNull(),
		inputDigest: text().notNull(),
		recoverAt: timestamptz().notNull(),
		accountGeneration: text().notNull(),
		outcome: text().$type<NotificationOutcome>(),
		createdAt: timestamptz().defaultNow().notNull(),
		reason: text().$type<NotificationDeliveryReason>(),
		state: text().$type<"settled" | "admitted">().notNull(),
		request: jsonb().$type<NotificationRequest>().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("notification_source_idx").on(
			table.userId,
			table.accountGeneration,
			table.sourceKey,
		),
		index("notification_recovery_idx").on(table.state, table.recoverAt, table.id),
		index("notification_owner_idx").on(table.userId, table.createdAt.desc(), table.id),
		index("notification_source_run_idx").on(table.sourceRunId),
		check(
			"notification_state_check",
			sql`(${table.state} = 'admitted' and ${table.outcome} is null and ${table.settledAt} is null) or (${table.state} = 'settled' and ${table.outcome} is not null and ${table.outcome} in ('accepted', 'partial', 'failed', 'unknown', 'not-sent') and ${table.settledAt} is not null)`,
		),
		check(
			"notification_reason_check",
			sql`${table.reason} is null or (${table.state} = 'settled' and ${table.outcome} = 'not-sent' and ${table.reason} = 'no-enabled-channels')`,
		),
		check(
			"notification_request_check",
			sql`jsonb_typeof(${table.request}) = 'object' and (${table.request} = '{"kind":"test"}'::jsonb or (${table.request} @> '{"kind":"message"}'::jsonb and ${table.request} ? 'message' and jsonb_typeof(${table.request}->'message') = 'string'))`,
		),
	],
);

export const notificationDelivery = snakeCase.table(
	"notification_delivery",
	{
		attemptId: text(),
		diagnostic: text(),
		id: text().primaryKey(),
		claimedAt: timestamptz(),
		settledAt: timestamptz(),
		channelId: text().notNull(),
		description: text().notNull(),
		reason: text().$type<NotificationDeliveryReason>(),
		channel: text().$type<NotificationChannelKind>().notNull(),
		status: text().$type<"queued" | "sending" | NotificationChannelOutcome>().notNull(),
		notificationId: text()
			.notNull()
			.references(() => notification.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("notification_delivery_channel_idx").on(table.notificationId, table.channelId),
		index("notification_delivery_claim_idx").on(table.status, table.claimedAt),
		index("notification_delivery_retention_idx").on(table.settledAt),
		check(
			"notification_delivery_status_check",
			sql`${table.status} in ('queued', 'sending', 'accepted', 'failed', 'unknown', 'skipped')`,
		),
		check(
			"notification_delivery_attempt_check",
			sql`(${table.attemptId} is null and ${table.claimedAt} is null and ${table.status} not in ('sending', 'accepted', 'unknown')) or (${table.attemptId} is not null and ${table.claimedAt} is not null and ${table.status} <> 'queued')`,
		),
		check(
			"notification_delivery_settlement_check",
			sql`(${table.status} in ('queued', 'sending') and ${table.settledAt} is null) or (${table.status} not in ('queued', 'sending') and ${table.settledAt} is not null)`,
		),
		check(
			"notification_delivery_reason_check",
			sql`(${table.status} in ('queued', 'sending', 'accepted') and ${table.reason} is null) or (${table.reason} is not null and ((${table.status} = 'failed' and ${table.reason} in ('preparation-failed', 'provider-rejected')) or (${table.status} = 'unknown' and ${table.reason} = 'delivery-unknown') or (${table.status} = 'skipped' and ${table.reason} in ('server-disabled', 'channel-disabled', 'channel-deleted', 'source-cancelled'))))`,
		),
	],
);
