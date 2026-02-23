import { generateId } from "better-auth";
import { relations, sql } from "drizzle-orm";
import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export * from "./auth";

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
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("sandbox_script_slug_idx").on(table.slug),
		index("sandbox_script_user_id_idx").on(table.userId),
		unique("sandbox_script_user_slug_unique").on(table.userId, table.slug),
	],
);

export const entitySchema = pgTable(
	"entity_schema",
	{
		slug: text().notNull(),
		name: text().notNull(),
		propertiesSchema: jsonb().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		eventSchemas: jsonb().notNull().default([]),
		displayConfig: jsonb().notNull().default({}),
		isBuiltin: boolean().notNull().default(false),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		searchSandboxScriptId: text().references(() => sandboxScript.id, {
			onDelete: "cascade",
		}),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
	},
	(table) => [
		index("entity_schema_slug_idx").on(table.slug),
		index("entity_schema_user_id_idx").on(table.userId),
		unique("entity_schema_user_slug_unique").on(table.userId, table.slug),
		index("entity_schema_search_sandbox_script_id_idx").on(
			table.searchSandboxScriptId,
		),
	],
);

export const entity = pgTable(
	"entity",
	{
		searchVector: text(),
		name: text().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		properties: jsonb().notNull().default({}),
		externalIds: jsonb().notNull().default({}),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		schemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date())
			.notNull(),
	},
	(table) => [
		index("entity_user_id_idx").on(table.userId),
		index("entity_schema_id_idx").on(table.schemaId),
		index("entity_properties_idx").using("gin", table.properties),
		index("entity_external_ids_idx").using("gin", table.externalIds),
		index("entity_search_vector_idx").using(
			"gin",
			sql`to_tsvector('english', ${table.name})`,
		),
	],
);

export const event = pgTable(
	"event",
	{
		eventType: text().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		occurredAt: timestamp().notNull().defaultNow(),
		properties: jsonb().notNull().default({}),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		sessionEntityId: text().references(() => entity.id, {
			onDelete: "set null",
		}),
		entityId: text()
			.notNull()
			.references(() => entity.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("event_type_idx").on(table.eventType),
		index("event_user_id_idx").on(table.userId),
		index("event_entity_id_idx").on(table.entityId),
		index("event_occurred_at_idx").on(table.occurredAt),
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
		id: text()
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
		displayConfig: jsonb().notNull().default({}),
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

export const entitySchemaRelations = relations(
	entitySchema,
	({ one, many }) => ({
		entities: many(entity),
		searchScript: one(sandboxScript, {
			references: [sandboxScript.id],
			fields: [entitySchema.searchSandboxScriptId],
		}),
		user: one(user, {
			references: [user.id],
			fields: [entitySchema.userId],
		}),
	}),
);

export const sandboxScriptRelations = relations(
	sandboxScript,
	({ one, many }) => ({
		entitySchemas: many(entitySchema),
		user: one(user, {
			references: [user.id],
			fields: [sandboxScript.userId],
		}),
	}),
);

export const entityRelations = relations(entity, ({ one, many }) => ({
	events: many(event),
	outgoingRelationships: many(relationship, {
		relationName: "sourceEntity",
	}),
	incomingRelationships: many(relationship, {
		relationName: "targetEntity",
	}),
	sessionEvents: many(event, {
		relationName: "sessionEntity",
	}),
	schema: one(entitySchema, {
		fields: [entity.schemaId],
		references: [entitySchema.id],
	}),
	user: one(user, {
		references: [user.id],
		fields: [entity.userId],
	}),
}));

export const eventRelations = relations(event, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [event.userId],
	}),
	entity: one(entity, {
		references: [entity.id],
		fields: [event.entityId],
	}),
	sessionEntity: one(entity, {
		references: [entity.id],
		relationName: "sessionEntity",
		fields: [event.sessionEntityId],
	}),
}));

export const relationshipRelations = relations(relationship, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [relationship.userId],
	}),
	sourceEntity: one(entity, {
		references: [entity.id],
		relationName: "sourceEntity",
		fields: [relationship.sourceEntityId],
	}),
	targetEntity: one(entity, {
		references: [entity.id],
		relationName: "targetEntity",
		fields: [relationship.targetEntityId],
	}),
}));

export const savedViewRelations = relations(savedView, ({ one }) => ({
	user: one(user, {
		references: [user.id],
		fields: [savedView.userId],
	}),
}));
