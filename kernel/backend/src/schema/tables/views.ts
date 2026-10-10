import type {
	ClientPageCompositionIdentity,
	ClientPageCompositionManifest,
} from "@ryot-app/contract/modules/pages/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { generateId } from "better-auth";
import { sql, type SQL } from "drizzle-orm";
import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	snakeCase,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { pluginInstallation } from "./core";
import { timestamptz, updatedAtColumn } from "./timestamps";

const framed = (component: SQL) => sql`char_length(${component})::text || ':' || ${component}`;

export const builtinSavedViewIdSql = (userId: SQL, pluginId: SQL, slug: SQL) => {
	const ownerKind = sql`case when ${pluginId} is null then 'kernel' else 'plugin' end`;
	const ownerId = sql`coalesce(${pluginId}, '')`;
	return sql<string>`'builtin:' || ${framed(userId)} || ${framed(ownerKind)} || ${framed(ownerId)} || ${framed(slug)}`;
};

export const clientPageComposition = snakeCase.table("client_page_composition", {
	compositionKey: text().primaryKey(),
	compositionHash: text().notNull().unique(),
	createdAt: timestamptz().defaultNow().notNull(),
	identity: jsonb().$type<ClientPageCompositionIdentity>().notNull(),
	manifest: jsonb().$type<ClientPageCompositionManifest>().notNull(),
});

export const pluginCatalogChange = snakeCase.table(
	"plugin_catalog_change",
	{
		createdAt: timestamptz().defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [index("plugin_catalog_change_user_id_idx").on(table.userId)],
);

export const savedView = snakeCase.table(
	"saved_view",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		pluginInstallationId: text(),
		updatedAt: updatedAtColumn(),
		revision: integer().notNull().default(1),
		sortOrder: integer().notNull().default(0),
		dataSources: jsonb().$type<RyotQLDocument>(),
		isHidden: boolean().notNull().default(false),
		createdAt: timestamptz().defaultNow().notNull(),
		renderer: jsonb().$type<SavedViewRenderer>().notNull(),
		settings: jsonb().$type<Readonly<Record<string, JsonValue>>>().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("saved_view_user_id_idx").on(table.userId),
		index("saved_view_slug_idx").on(table.slug),
		index("saved_view_plugin_installation_id_idx").on(table.pluginInstallationId),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
		foreignKey({
			name: "saved_view_plugin_installation_owner_fk",
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
		}).onDelete("restrict"),
	],
);

export const savedViewOverride = snakeCase.table(
	"saved_view_override",
	{
		pluginId: text(),
		slug: text().notNull(),
		sortOrder: integer().notNull(),
		revision: integer().notNull().default(1),
		isHidden: boolean().notNull().default(false),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("saved_view_override_kernel_unique")
			.on(table.userId, table.slug)
			.where(sql`${table.pluginId} is null`),
		uniqueIndex("saved_view_override_plugin_unique")
			.on(table.userId, table.pluginId, table.slug)
			.where(sql`${table.pluginId} is not null`),
	],
);

export const calendarSourceOverride = snakeCase.table(
	"calendar_source_override",
	{
		slug: text().notNull(),
		pluginId: text().notNull(),
		isHidden: boolean().notNull().default(false),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("calendar_source_override_user_plugin_slug_unique").on(
			table.userId,
			table.pluginId,
			table.slug,
		),
	],
);
