import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { generateId } from "better-auth";
import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin, pluginInstallation } from "./core";

// TODO: Expose as an RSS feed
export const savedView = snakeCase.table(
	"saved_view",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		entitySchemaSlug: text(),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		layouts: jsonb().$type<SavedViewLayouts>().notNull(),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		entitySchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		pluginInstallationId: text(),
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
		index("saved_view_entity_schema_plugin_id_idx").on(table.entitySchemaPluginId),
		index("saved_view_plugin_installation_id_idx").on(table.pluginInstallationId),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
		foreignKey({
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
			name: "saved_view_plugin_installation_owner_fk",
		}).onDelete("restrict"),
	],
);
