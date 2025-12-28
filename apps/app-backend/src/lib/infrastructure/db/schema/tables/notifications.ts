import type { NotificationPlatformSpecifics } from "@ryot/contract/modules/notifications/schemas";
import type {
	NotificationEventType,
	NotificationPlatformKind,
} from "@ryot/contract/modules/notifications/types";
import { generateId } from "better-auth";
import { index, jsonb, pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const notificationPlatform = pgTable(
	"notification_platform",
	{
		isDisabled: boolean().notNull().default(false),
		platform: text().notNull().$type<NotificationPlatformKind>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		platformSpecifics: jsonb().notNull().$type<NotificationPlatformSpecifics>(),
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
		index("notification_platform_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
		index("notification_platform_user_id_is_disabled_idx").on(table.userId, table.isDisabled),
	],
);
