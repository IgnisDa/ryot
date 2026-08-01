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
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
		uniqueIndex("entity_user_plugin_external_id_unique")
			.on(
				table.userId,
				table.externalId,
				table.entitySchemaSlug,
				table.providerId,
				table.entitySchemaPluginId,
			)
			.where(
				sql`${table.userId} IS NOT NULL AND ${table.externalId} IS NOT NULL AND ${table.providerId} IS NOT NULL AND ${table.entitySchemaPluginId} IS NOT NULL`,
			),
		uniqueIndex("entity_user_kernel_external_id_unique")
			.on(table.userId, table.externalId, table.entitySchemaSlug, table.providerId)
			.where(
				sql`${table.userId} IS NOT NULL AND ${table.externalId} IS NOT NULL AND ${table.providerId} IS NOT NULL AND ${table.entitySchemaPluginId} IS NULL`,
			),
		uniqueIndex("entity_global_plugin_external_id_unique")
			.on(table.externalId, table.entitySchemaSlug, table.providerId, table.entitySchemaPluginId)
			.where(
				sql`${table.userId} IS NULL AND ${table.providerId} IS NOT NULL AND ${table.entitySchemaPluginId} IS NOT NULL`,
			),
		uniqueIndex("entity_global_kernel_external_id_unique")
			.on(table.externalId, table.entitySchemaSlug, table.providerId)
			.where(
				sql`${table.userId} IS NULL AND ${table.providerId} IS NOT NULL AND ${table.entitySchemaPluginId} IS NULL`,
			),
		uniqueIndex("entity_global_plugin_no_provider_external_id_unique")
			.on(table.externalId, table.entitySchemaSlug, table.entitySchemaPluginId)
			.where(
				sql`${table.userId} IS NULL AND ${table.providerId} IS NULL AND ${table.entitySchemaPluginId} IS NOT NULL`,
			),
		uniqueIndex("entity_global_kernel_no_provider_external_id_unique")
			.on(table.externalId, table.entitySchemaSlug)
			.where(
				sql`${table.userId} IS NULL AND ${table.providerId} IS NULL AND ${table.entitySchemaPluginId} IS NULL`,
			),
	],
);

export const relationship = snakeCase.table(
	"relationship",
	{
		relationshipSchemaSlug: text().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		relationshipSchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		sourceEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		targetEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
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
