import type { NotificationChannelSpecifics } from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, snakeCase, text } from "drizzle-orm/pg-core";

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
