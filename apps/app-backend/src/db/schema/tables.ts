import { generateId } from "better-auth";
import { sql } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

const tsvector = customType<{ data: string }>({
	dataType: () => "tsvector",
});

export const entitySchema = pgTable(
	"entity_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		propertiesSchema: jsonb().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		isBuiltin: boolean().notNull().default(false),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("entity_schema_user_id_idx").on(table.userId),
		unique("entity_schema_user_slug_unique").on(table.userId, table.slug),
	],
);

export const eventSchema = pgTable(
	"event_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		propertiesSchema: jsonb().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("event_schema_entity_schema_id_idx").on(table.entitySchemaId),
		unique("event_schema_user_entity_schema_slug_unique").on(
			table.userId,
			table.entitySchemaId,
			table.slug,
		),
	],
);

export const sandboxScript = pgTable(
	"sandbox_script",
	{
		slug: text().notNull(),
		name: text().notNull(),
		code: text().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		isBuiltin: boolean().notNull().default(false),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("sandbox_script_user_id_idx").on(table.userId),
		unique("sandbox_script_user_slug_unique").on(table.userId, table.slug),
	],
);

export const entitySchemaSandboxScript = pgTable(
	"entity_schema_sandbox_script",
	{
		createdAt: timestamp().defaultNow().notNull(),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		searchSandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		detailsSandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("entity_schema_sandbox_script_entity_schema_id_idx").on(
			table.entitySchemaId,
		),
		index("entity_schema_sandbox_script_search_script_id_idx").on(
			table.searchSandboxScriptId,
		),
		index("entity_schema_sandbox_script_details_script_id_idx").on(
			table.detailsSandboxScriptId,
		),
		unique("entity_schema_sandbox_script_unique").on(
			table.entitySchemaId,
			table.searchSandboxScriptId,
			table.detailsSandboxScriptId,
		),
	],
);

export const entity = pgTable(
	"entity",
	{
		name: text().notNull(),
		externalId: text().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		properties: jsonb().notNull().default({}),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		searchVector: tsvector()
			.notNull()
			.generatedAlwaysAs(sql`to_tsvector('english', name)`),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		detailsSandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("entity_user_id_idx").on(table.userId),
		index("entity_external_id_idx").on(table.externalId),
		index("entity_entity_schema_id_idx").on(table.entitySchemaId),
		index("entity_properties_idx").using("gin", table.properties),
		index("entity_search_vector_idx").using("gin", table.searchVector),
		index("entity_details_sandbox_script_id_idx").on(
			table.detailsSandboxScriptId,
		),
		unique("entity_user_schema_script_external_id_unique").on(
			table.userId,
			table.externalId,
			table.entitySchemaId,
			table.detailsSandboxScriptId,
		),
	],
);

export const event = pgTable(
	"event",
	{
		createdAt: timestamp().defaultNow().notNull(),
		occurredAt: timestamp().notNull().defaultNow(),
		properties: jsonb().notNull().default({}),
		sessionEntityId: text().references(() => entity.id, {
			onDelete: "cascade",
		}),
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
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("event_user_id_idx").on(table.userId),
		index("event_entity_id_idx").on(table.entityId),
		index("event_occurred_at_idx").on(table.occurredAt),
		index("event_event_schema_id_idx").on(table.eventSchemaId),
		index("event_session_entity_id_idx").on(table.sessionEntityId),
		index("event_properties_idx").using("gin", table.properties),
	],
);

export const relationship = pgTable(
	"relationship",
	{
		relType: text().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		properties: jsonb().notNull().default({}),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
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
		index("relationship_rel_type_idx").on(table.relType),
		index("relationship_source_entity_id_idx").on(table.sourceEntityId),
		index("relationship_target_entity_id_idx").on(table.targetEntityId),
		index("relationship_properties_idx").using("gin", table.properties),
	],
);

export const savedView = pgTable(
	"saved_view",
	{
		name: text().notNull(),
		queryDefinition: jsonb().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [index("saved_view_user_id_idx").on(table.userId)],
);

export const appConfig = pgTable(
	"app_config",
	{
		value: text(),
		key: text().primaryKey(),
		createdAt: timestamp().defaultNow().notNull(),
		updatedByUserId: text().references(() => user.id, { onDelete: "set null" }),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("app_config_updated_by_user_id_idx").on(table.updatedByUserId),
	],
);
