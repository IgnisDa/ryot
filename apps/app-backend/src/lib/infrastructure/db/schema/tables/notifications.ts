import type { NotificationChannelSpecifics } from "@ryot/contract/modules/notifications/schemas";
import type {
	NotificationChannelKind,
	NotificationEventType,
} from "@ryot/contract/modules/notifications/types";
import { generateId } from "better-auth";
import { index, jsonb, pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const notificationChannel = pgTable(
	"notification_channel",
	{
		isDisabled: boolean().notNull().default(false),
		channel: text("platform").notNull().$type<NotificationChannelKind>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		channelSpecifics: jsonb("platform_specifics").notNull().$type<NotificationChannelSpecifics>(),
		configuredEvents: text().array().notNull().$type<NotificationEventType[]>(),
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
