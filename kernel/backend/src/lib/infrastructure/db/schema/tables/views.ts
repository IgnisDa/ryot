import type {
	ClientPageGraphIdentity,
	ClientRendererDefinition,
} from "@ryot-app/contract/modules/client-pages/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { SavedViewRenderer } from "@ryot-app/contract/modules/saved-views/schemas";
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
import { pluginClientArtifact, pluginInstallation } from "./core";

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
		kernelRendererName: text(),
		graphHash: text().notNull(),
		publishedHash: text().notNull(),
		graphIdentity: jsonb().$type<ClientPageGraphIdentity>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		rendererId: text().references(() => clientRenderer.id, { onDelete: "cascade" }),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
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
		unique("client_page_build_kernel_graph_unique").on(
			table.userId,
			table.kernelRendererName,
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
		dataSources: jsonb().$type<RyotQLDocument>(),
		revision: integer().notNull().default(1),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		renderer: jsonb().$type<SavedViewRenderer>().notNull(),
		settings: jsonb().$type<Readonly<Record<string, JsonValue>>>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
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
		index("saved_view_plugin_installation_id_idx").on(table.pluginInstallationId),
		index("saved_view_client_renderer_id_idx").on(table.clientRendererId),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
		foreignKey({
			name: "saved_view_plugin_installation_owner_fk",
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
		}).onDelete("restrict"),
	],
);
