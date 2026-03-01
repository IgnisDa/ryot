import type { DisplayConfiguration } from "@ryot/contract/display-configuration";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
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

import { user } from "./auth";

// TODO: Expose as an RSS feed
export const savedView = pgTable(
	"saved_view",
	{
		pluginSlug: text(),
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		queryDocument: jsonb().$type<QueryDocument>().notNull(),
		displayConfiguration: jsonb().$type<DisplayConfiguration>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
		index("saved_view_plugin_slug_idx").on(table.pluginSlug),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
	],
);
