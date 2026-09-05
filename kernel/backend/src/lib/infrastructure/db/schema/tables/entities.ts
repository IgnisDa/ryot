import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import { index, jsonb, snakeCase, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin, sandboxProvider } from "./core";

export const entity = snakeCase.table(
	"entity",
	{
		externalId: text(),
		name: text().notNull(),
		entitySchemaSlug: text().notNull(),
		populatedAt: timestamp({ withTimezone: true }),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		providerId: text().references(() => sandboxProvider.id, { onDelete: "cascade" }),
		entitySchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
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
		index("entity_user_id_idx").on(table.userId),
		index("entity_external_id_idx").on(table.externalId),
		index("entity_provider_id_idx").on(table.providerId),
		index("entity_entity_schema_slug_idx").on(table.entitySchemaSlug),
		index("entity_entity_schema_plugin_id_idx").on(table.entitySchemaPluginId),
		index("entity_properties_idx").using("gin", table.properties),
		uniqueIndex("entity_external_identity_unique")
			.on(
				table.externalId,
				table.entitySchemaSlug,
				sql`(case when ${table.userId} is null then '0' else '1' || ${table.userId} end)`,
				sql`(case when ${table.providerId} is null then '0' else '1' || ${table.providerId} end)`,
				sql`(case when ${table.entitySchemaPluginId} is null then '0' else '1' || ${table.entitySchemaPluginId} end)`,
			)
			.where(
				sql`${table.externalId} is not null and (${table.userId} is null or ${table.providerId} is not null)`,
			),
	],
);

export const relationship = snakeCase.table(
	"relationship",
	{
		relationshipSchemaSlug: text().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		relationshipSchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		sourceEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		targetEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("relationship_schema_slug_idx").on(table.relationshipSchemaSlug),
		index("relationship_schema_plugin_id_idx").on(table.relationshipSchemaPluginId),
		index("relationship_source_entity_id_idx").on(table.sourceEntityId),
		index("relationship_target_entity_id_idx").on(table.targetEntityId),
		index("relationship_properties_idx").using("gin", table.properties),
		unique("relationship_identity_unique")
			.on(
				table.userId,
				table.sourceEntityId,
				table.targetEntityId,
				table.relationshipSchemaSlug,
				table.relationshipSchemaPluginId,
			)
			.nullsNotDistinct(),
	],
);
