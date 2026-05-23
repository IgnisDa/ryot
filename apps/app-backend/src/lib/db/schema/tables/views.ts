import { generateId } from "better-auth";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import type { DisplayConfiguration } from "#lib/query-language";
import type { QueryDocument } from "#modules/query-engine/language";

import { user } from "../auth";
import { tracker } from "./core";

export const savedView = pgTable(
	"saved_view",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().default(false).notNull(),
		isDisabled: boolean().notNull().default(false),
		queryDocument: jsonb().$type<typeof QueryDocument.Type>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		displayConfiguration: jsonb().$type<typeof DisplayConfiguration.Type>().notNull(),
		trackerId: text().references(() => tracker.id, { onDelete: "set null" }),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("saved_view_user_id_idx").on(table.userId),
		index("saved_view_tracker_id_idx").on(table.trackerId),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
	],
);
