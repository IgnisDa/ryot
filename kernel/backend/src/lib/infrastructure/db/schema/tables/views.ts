import type { ClientPageArtifactIdentity } from "@ryot-app/contract/modules/client-pages/schemas";
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

export const clientPageBuild = snakeCase.table("client_page_build", {
	artifactKey: text().primaryKey(),
	createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
	artifactIdentity: jsonb().$type<ClientPageArtifactIdentity>().notNull(),
	artifactHash: text()
		.notNull()
		.references(() => pluginClientArtifact.hash, { onDelete: "restrict" }),
});

// TODO: Expose as an RSS feed
export const savedView = snakeCase.table(
	"saved_view",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		pluginInstallationId: text(),
		revision: integer().notNull().default(1),
		sortOrder: integer().notNull().default(0),
		dataSources: jsonb().$type<RyotQLDocument>(),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		renderer: jsonb().$type<SavedViewRenderer>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		settings: jsonb().$type<Readonly<Record<string, JsonValue>>>().notNull(),
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
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
		foreignKey({
			name: "saved_view_plugin_installation_owner_fk",
			columns: [table.pluginInstallationId, table.userId],
			foreignColumns: [pluginInstallation.id, pluginInstallation.userId],
		}).onDelete("restrict"),
	],
);
