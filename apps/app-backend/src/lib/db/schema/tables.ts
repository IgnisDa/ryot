import { dayjs } from "@ryot/ts-utils";
import { generateId } from "better-auth";
import { isNull, sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ImageSchemaType } from "../../zod";
import { user } from "./auth";

export const tracker = pgTable(
	"tracker",
	{
		description: text(),
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		config: jsonb().notNull().default({}),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("tracker_user_id_idx").on(table.userId),
		unique("tracker_user_slug_unique").on(table.userId, table.slug),
	],
);

export const entitySchema = pgTable(
	"entity_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		propertiesSchema: jsonb().notNull(),
		isBuiltin: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("entity_schema_user_id_idx").on(table.userId),
		unique("entity_schema_user_slug_unique").on(table.userId, table.slug),
	],
);

export const trackerEntitySchema = pgTable(
	"tracker_entity_schema",
	{
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		trackerId: text()
			.notNull()
			.references(() => tracker.id, { onDelete: "cascade" }),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("tracker_entity_schema_tracker_id_idx").on(table.trackerId),
		index("tracker_entity_schema_entity_schema_id_idx").on(
			table.entitySchemaId,
		),
		unique("tracker_entity_schema_unique").on(
			table.trackerId,
			table.entitySchemaId,
		),
	],
);

export const eventSchema = pgTable(
	"event_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		propertiesSchema: jsonb().notNull(),
		isBuiltin: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("event_schema_entity_schema_id_idx").on(table.entitySchemaId),
		unique("event_schema_user_entity_schema_slug_unique").on(
			table.userId,
			table.entitySchemaId,
			table.slug,
		),
		uniqueIndex("event_schema_builtin_entity_schema_slug_unique")
			.on(table.entitySchemaId, table.slug)
			.where(sql`${table.userId} is null`),
	],
);

export const sandboxScript = pgTable(
	"sandbox_script",
	{
		slug: text().notNull(),
		name: text().notNull(),
		code: text().notNull(),
		metadata: jsonb().notNull(),
		isBuiltin: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("sandbox_script_user_id_idx").on(table.userId),
		unique("sandbox_script_user_slug_unique").on(table.userId, table.slug),
	],
);

export const entitySchemaScript = pgTable(
	"entity_schema_script",
	{
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		sandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("entity_schema_script_entity_schema_id_idx").on(table.entitySchemaId),
		index("entity_schema_script_sandbox_script_id_idx").on(
			table.sandboxScriptId,
		),
		unique("entity_schema_script_unique").on(
			table.entitySchemaId,
			table.sandboxScriptId,
		),
	],
);

export const entity = pgTable(
	"entity",
	{
		externalId: text(),
		name: text().notNull(),
		image: jsonb().$type<ImageSchemaType>(),
		properties: jsonb().notNull().default({}),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		populatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
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

export const event = pgTable(
	"event",
	{
		properties: jsonb().notNull().default({}),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		eventSchemaId: text()
			.notNull()
			.references(() => eventSchema.id, { onDelete: "cascade" }),
		entityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("event_user_id_idx").on(table.userId),
		index("event_entity_id_idx").on(table.entityId),
		index("event_event_schema_id_idx").on(table.eventSchemaId),
		index("event_properties_idx").using("gin", table.properties),
	],
);

export const relationshipSchema = pgTable(
	"relationship_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		propertiesSchema: jsonb().notNull(),
		isBuiltin: boolean().notNull().default(false),
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
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("relationship_schema_user_id_idx").on(table.userId),
		index("relationship_schema_source_entity_schema_id_idx").on(
			table.sourceEntitySchemaId,
		),
		index("relationship_schema_target_entity_schema_id_idx").on(
			table.targetEntitySchemaId,
		),
		unique("relationship_schema_user_slug_unique").on(table.userId, table.slug),
		uniqueIndex("relationship_schema_builtin_slug_unique")
			.on(table.slug)
			.where(sql`${table.userId} is null`),
	],
);

export const relationship = pgTable(
	"relationship",
	{
		properties: jsonb().notNull().default({}),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
			.on(
				table.sourceEntityId,
				table.targetEntityId,
				table.relationshipSchemaId,
			)
			.where(isNull(table.userId)),
	],
);

export const eventSchemaTrigger = pgTable(
	"event_schema_trigger",
	{
		name: text().notNull(),
		isActive: boolean().notNull().default(true),
		isBuiltin: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		eventSchemaId: text()
			.notNull()
			.references(() => eventSchema.id, { onDelete: "cascade" }),
		sandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("event_schema_trigger_user_id_idx").on(table.userId),
		index("event_schema_trigger_event_schema_id_idx").on(table.eventSchemaId),
		uniqueIndex("event_schema_trigger_builtin_unique")
			.on(table.eventSchemaId, table.sandboxScriptId)
			.where(sql`${table.userId} is null`),
		unique("event_schema_trigger_user_unique").on(
			table.userId,
			table.eventSchemaId,
			table.sandboxScriptId,
		),
	],
);

export const savedView = pgTable(
	"saved_view",
	{
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		queryDefinition: jsonb().notNull(),
		displayConfiguration: jsonb().notNull(),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().default(false).notNull(),
		isDisabled: boolean().notNull().default(false),
		createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
		trackerId: text().references(() => tracker.id, { onDelete: "set null" }),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp({ withTimezone: true })
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("saved_view_user_id_idx").on(table.userId),
		index("saved_view_tracker_id_idx").on(table.trackerId),
		unique("saved_view_user_slug_unique").on(table.userId, table.slug),
	],
);
