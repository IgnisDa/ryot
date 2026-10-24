import { index, primaryKey, snakeCase, text } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin } from "./core";
import { timestamptz } from "./timestamps";

export const signalScheduleDelivery = snakeCase.table(
	"signal_schedule_delivery",
	{
		triggerId: text().notNull(),
		scheduleSlug: text().notNull(),
		occurrenceKey: text().notNull(),
		createdAt: timestamptz().notNull().defaultNow(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		pluginId: text()
			.notNull()
			.references(() => plugin.id, { onDelete: "cascade" }),
	},
	(table) => [
		primaryKey({
			columns: [table.userId, table.pluginId, table.scheduleSlug, table.occurrenceKey],
		}),
		index("signal_schedule_delivery_created_at_idx").on(table.createdAt),
	],
);
