import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { generateId } from "better-auth";
import { isNull, sql } from "drizzle-orm";
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { entitySchema, sandboxScript } from "./core";

export const entity = pgTable(
	"entity",
	{
		externalId: text(),
		name: text().notNull(),
		populatedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		sandboxScriptId: text().references(() => sandboxScript.id, {
			onDelete: "cascade",
		}),
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
		index("entity_entity_schema_id_idx").on(table.entitySchemaId),
		index("entity_properties_idx").using("gin", table.properties),
		index("entity_sandbox_script_id_idx").on(table.sandboxScriptId),
		unique("entity_user_schema_script_external_id_unique").on(
			table.userId,
			table.externalId,
			table.entitySchemaId,
			table.sandboxScriptId,
		),
		uniqueIndex("entity_global_external_id_unique")
			.on(table.externalId, table.entitySchemaId, table.sandboxScriptId)
			.where(isNull(table.userId)),
		// `sandbox_script_id` can be NULL for built-in entities (e.g., exercises).
		// Without NULLS NOT DISTINCT support in Drizzle's uniqueIndex(), the existing
		// `entity_global_external_id_unique` index (which includes sandbox_script_id)
		// treats NULL sandbox_script_id values as distinct, preventing correct upserts
		// for global entities with no script. This separate partial index covers that case.
		// TODO: collapse into `entity_global_external_id_unique` once Drizzle supports
		// NULLS NOT DISTINCT on uniqueIndex():
		// https://github.com/drizzle-team/drizzle-orm/issues/3892
		uniqueIndex("entity_global_no_script_external_id_unique")
			.on(table.externalId, table.entitySchemaId)
			.where(sql`${table.userId} IS NULL AND ${table.sandboxScriptId} IS NULL`),
	],
);

export const relationshipSchema = pgTable(
	"relationship_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		isBuiltin: boolean().notNull().default(false),
		propertiesSchema: jsonb().$type<AppSchema>().notNull(),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		sourceEntitySchemaId: text().references(() => entitySchema.id, {
			onDelete: "cascade",
		}),
		targetEntitySchemaId: text().references(() => entitySchema.id, {
			onDelete: "cascade",
		}),
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
		index("relationship_schema_user_id_idx").on(table.userId),
		index("relationship_schema_source_entity_schema_id_idx").on(table.sourceEntitySchemaId),
		index("relationship_schema_target_entity_schema_id_idx").on(table.targetEntitySchemaId),
		unique("relationship_schema_user_slug_unique").on(table.userId, table.slug),
		uniqueIndex("relationship_schema_builtin_slug_unique")
			.on(table.slug)
			.where(sql`${table.userId} is null`),
	],
);

export const relationship = pgTable(
	"relationship",
	{
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		properties: jsonb().$type<Record<string, unknown>>().notNull().default({}),
		sourceEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		targetEntityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		relationshipSchemaId: text()
			.notNull()
			.references(() => relationshipSchema.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("relationship_schema_id_idx").on(table.relationshipSchemaId),
		index("relationship_source_entity_id_idx").on(table.sourceEntityId),
		index("relationship_target_entity_id_idx").on(table.targetEntityId),
		index("relationship_properties_idx").using("gin", table.properties),
		unique("relationship_user_source_target_schema_unique").on(
			table.userId,
			table.sourceEntityId,
			table.targetEntityId,
			table.relationshipSchemaId,
		),
		uniqueIndex("relationship_global_source_target_schema_unique")
			.on(table.sourceEntityId, table.targetEntityId, table.relationshipSchemaId)
			.where(isNull(table.userId)),
	],
);
