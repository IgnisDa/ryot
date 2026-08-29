import type { NotificationChannelSpecifics } from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import { generateId } from "better-auth";
import { index, jsonb, snakeCase, text, timestamp, boolean } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const notificationChannel = snakeCase.table(
	"notification_channel",
	{
		description: text().notNull(),
		isDisabled: boolean().notNull().default(false),
		channel: text("platform").notNull().$type<NotificationChannelKind>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		channelSpecifics: jsonb("platform_specifics").notNull().$type<NotificationChannelSpecifics>(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("notification_channel_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("notification_channel_user_id_is_disabled_idx").on(table.userId, table.isDisabled),
	],
);
