import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import { index, jsonb, snakeCase, text, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { plugin, sandboxProvider } from "./core";
import { timestamptz, updatedAtColumn } from "./timestamps";

export const entity = snakeCase.table(
	"entity",
	{
		externalId: text(),
		name: text().notNull(),
		populatedAt: timestamptz(),
		updatedAt: updatedAtColumn(),
		entitySchemaSlug: text().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		providerId: text().references(() => sandboxProvider.id, { onDelete: "cascade" }),
		entitySchemaPluginId: text().references(() => plugin.id, { onDelete: "restrict" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("entity_user_id_idx").on(table.userId),
		index("entity_external_id_idx").on(table.externalId),
		index("entity_provider_id_idx").on(table.providerId),
		index("entity_entity_schema_slug_idx").on(table.entitySchemaSlug),
		index("entity_entity_schema_plugin_id_idx").on(table.entitySchemaPluginId),
		index("entity_properties_idx").using("gin", table.properties),
		uniqueIndex("entity_collection_name_unique")
			.on(table.userId, table.name)
			.where(
				sql`${table.entitySchemaSlug} = 'collection' and ${table.entitySchemaPluginId} is null`,
			),
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
		updatedAt: updatedAtColumn(),
		relationshipSchemaSlug: text().notNull(),
		createdAt: timestamptz().defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
