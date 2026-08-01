import type {
	ClientPageGraphIdentity,
	ClientRendererDefinition,
} from "@ryot-app/contract/modules/client-pages/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type {
	SavedViewLayouts,
	SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
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
import { plugin, pluginClientArtifact, pluginInstallation } from "./core";

export const clientRenderer = snakeCase.table(
	"client_renderer",
	{
		publishedHash: text(),
		slug: text().notNull(),
		name: text().notNull(),
		publishedRevision: integer(),
		draftRevision: integer().notNull().default(1),
		publishedDefinition: jsonb().$type<ClientRendererDefinition>(),
		draftDefinition: jsonb().$type<ClientRendererDefinition>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		publishedArtifactHash: text().references(() => pluginClientArtifact.hash, {
			onDelete: "restrict",
		}),
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
		index("client_renderer_user_id_idx").on(table.userId),
		unique("client_renderer_user_slug_unique").on(table.userId, table.slug),
	],
);

export const clientPageBuild = snakeCase.table(
	"client_page_build",
	{
		graphHash: text().notNull(),
		publishedHash: text().notNull(),
		graphIdentity: jsonb().$type<ClientPageGraphIdentity>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		rendererId: text()
			.notNull()
			.references(() => clientRenderer.id, { onDelete: "cascade" }),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		artifactHash: text()
			.notNull()
			.references(() => pluginClientArtifact.hash, { onDelete: "restrict" }),
	},
	(table) => [
		index("client_page_build_user_id_idx").on(table.userId),
		unique("client_page_build_graph_unique").on(
			table.rendererId,
			table.publishedHash,
			table.graphHash,
		),
	],
);

// TODO: Expose as an RSS feed
export const savedView = snakeCase.table(
	"saved_view",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		entitySchemaSlug: text(),
		layouts: jsonb().$type<SavedViewLayouts>(),
		dataSources: jsonb().$type<RyotQLDocument>(),
		renderer: jsonb().$type<SavedViewRenderer>(),
		revision: integer().notNull().default(1),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		settings: jsonb().$type<Readonly<Record<string, JsonValue>>>(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		entitySchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		clientRendererId: text().references(() => clientRenderer.id, { onDelete: "restrict" }),
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
		index("saved_view_client_renderer_id_idx").on(table.clientRendererId),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
		foreignKey({
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
			name: "saved_view_plugin_installation_owner_fk",
		}).onDelete("restrict"),
	],
);
