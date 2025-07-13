import { z } from "@hono/zod-openapi";
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
import { user } from "./auth";

const remoteImageUrlSchema = z
	.string()
	.trim()
	.superRefine((value, ctx) => {
		try {
			const parsedUrl = new URL(value);
			if (!["http:", "https:"].includes(parsedUrl.protocol)) {
				throw new Error();
			}
		} catch {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Entity image remote url must be a valid URL",
			});
		}
	});

const s3ImageKeySchema = z
	.string()
	.trim()
	.min(1, "Entity image s3 key is required");

export const remoteImageSchema = z.strictObject({
	url: remoteImageUrlSchema,
	kind: z.literal("remote"),
});

export const s3ImageSchema = z.strictObject({
	key: s3ImageKeySchema,
	kind: z.literal("s3"),
});

export const ImageSchema = z.discriminatedUnion("kind", [
	s3ImageSchema,
	remoteImageSchema,
]);

export type ImageSchemaType = z.infer<typeof ImageSchema>;

export const tracker = pgTable(
	"tracker",
	{
		description: text(),
		slug: text().notNull(),
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		config: jsonb().notNull().default({}),
		createdAt: timestamp().defaultNow().notNull(),
		sortOrder: integer().notNull().default(0),
		isBuiltin: boolean().notNull().default(false),
		isDisabled: boolean().notNull().default(false),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
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
		createdAt: timestamp().defaultNow().notNull(),
		isBuiltin: boolean().notNull().default(false),
		userId: text().references(() => user.id, { onDelete: "cascade" }),
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		updatedAt: timestamp()
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
		createdAt: timestamp().defaultNow().notNull(),
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
		updatedAt: timestamp()
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
		createdAt: timestamp().defaultNow().notNull(),
		isBuiltin: boolean().notNull().default(false),
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
		metadata: jsonb(),
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
		id: text()
			.notNull()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		entitySchemaId: text()
			.notNull()
			.references(() => entitySchema.id, { onDelete: "cascade" }),
		sandboxScriptId: text()
			.notNull()
			.references(() => sandboxScript.id, { onDelete: "cascade" }),
		createdAt: timestamp().defaultNow().notNull(),
		updatedAt: timestamp()
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
		createdAt: timestamp().defaultNow().notNull(),
		properties: jsonb().notNull().default({}),
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
		updatedAt: timestamp()
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
	],
);

export const event = pgTable(
	"event",
	{
		createdAt: timestamp().defaultNow().notNull(),
		properties: jsonb().notNull().default({}),
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
		createdAt: timestamp().defaultNow().notNull(),
		isBuiltin: boolean().notNull().default(false),
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
		updatedAt: timestamp()
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
		createdAt: timestamp().defaultNow().notNull(),
		properties: jsonb().notNull().default({}),
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

export const savedView = pgTable(
	"saved_view",
	{
		name: text().notNull(),
		icon: text().notNull(),
		accentColor: text().notNull(),
		queryDefinition: jsonb().notNull(),
		displayConfiguration: jsonb().notNull(),
		createdAt: timestamp().defaultNow().notNull(),
		sortOrder: integer().notNull().default(0),
		isDisabled: boolean().notNull().default(false),
		isBuiltin: boolean().default(false).notNull(),
		trackerId: text().references(() => tracker.id, { onDelete: "set null" }),
		id: text()
			.primaryKey()
			.$defaultFn(() => /* @__PURE__ */ generateId()),
		userId: text()
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		updatedAt: timestamp()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ dayjs().toDate())
			.notNull(),
	},
	(table) => [
		index("saved_view_user_id_idx").on(table.userId),
		index("saved_view_tracker_id_idx").on(table.trackerId),
	],
);
