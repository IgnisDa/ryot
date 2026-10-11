import { PluginId } from "@ryot-app/contract/schema/brands";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import {
	GLOBAL_WRITE_SANDBOX_LIMITS,
	USER_ENTITY_READ_SANDBOX_LIMITS,
	USER_ENTITY_WRITE_SANDBOX_LIMITS,
} from "./limits";
import { globalPropertiesSchema, nonEmptyString, sandboxIdSchema } from "./primitives";
import { submissionOptionsSchema } from "./writes";

export const sandboxEntitySchemaSlugListSchema = Schema.Array(sandboxIdSchema).pipe(
	Schema.check(Schema.isMaxLength(USER_ENTITY_READ_SANDBOX_LIMITS.ids)),
);
export const entityRecordSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	properties: jsonValueSchema,
	entitySchemaSlug: Schema.String,
	providerId: Schema.NullOr(Schema.String),
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(Schema.String),
	entitySchemaPluginId: Schema.NullOr(PluginId),
});
export type EntityRecord = Schema.Schema.Type<typeof entityRecordSchema>;
export const entitySchemaProviderSchema = strictStruct({
	name: Schema.String,
	providerId: Schema.String,
});
export const entitySchemaRecordSchema = strictStruct({
	id: Schema.String,
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	isBuiltin: Schema.Boolean,
	pluginId: Schema.NullOr(PluginId),
	propertiesSchema: jsonValueSchema,
	providers: Schema.Array(entitySchemaProviderSchema),
});
export type EntitySchemaRecord = Schema.Schema.Type<typeof entitySchemaRecordSchema>;
export const ensureUserEntityItemSchema = strictStruct({
	name: nonEmptyString,
	entitySchemaSlug: nonEmptyString,
	properties: globalPropertiesSchema,
});
export type EnsureUserEntityItem = Schema.Schema.Type<typeof ensureUserEntityItemSchema>;
export const ensureUserEntityResultSchema = strictStruct({
	entityId: sandboxIdSchema,
	wasInserted: Schema.Boolean,
});
export type EnsureUserEntityResult = Schema.Schema.Type<typeof ensureUserEntityResultSchema>;
export const upsertGlobalEntityItemSchema = strictStruct({
	name: nonEmptyString,
	externalId: nonEmptyString,
	entitySchemaSlug: nonEmptyString,
	properties: globalPropertiesSchema,
	populatedAt: Schema.NullOr(Schema.String),
});
export type UpsertGlobalEntityItem = Schema.Schema.Type<typeof upsertGlobalEntityItemSchema>;
export const upsertGlobalEntitiesOptionsSchema = strictStruct({
	maximumTotal: Schema.optional(
		Schema.Number.pipe(
			Schema.check(Schema.isInt()),
			Schema.check(Schema.isGreaterThanOrEqualTo(0)),
		),
	),
});
export type UpsertGlobalEntitiesOptions = Schema.Schema.Type<
	typeof upsertGlobalEntitiesOptionsSchema
>;
export const upsertGlobalEntityResultSchema = Schema.Union([
	strictStruct({ status: Schema.Literal("skipped") }),
	strictStruct({
		entityId: sandboxIdSchema,
		wasInserted: Schema.Boolean,
		status: Schema.Literal("upserted"),
	}),
]);
export type UpsertGlobalEntityResult = Schema.Schema.Type<typeof upsertGlobalEntityResultSchema>;
export const getEntitySchemasArgsSchema = Schema.Tuple([sandboxEntitySchemaSlugListSchema]);
export const getEntitySchemasResultSchema = hostResultSchema(
	Schema.Array(entitySchemaRecordSchema),
);
export const upsertGlobalEntitiesDataSchema = Schema.Array(upsertGlobalEntityResultSchema);
export const upsertGlobalEntitiesResultSchema = hostResultSchema(upsertGlobalEntitiesDataSchema);
export const ensureUserEntitiesArgsSchema = Schema.Tuple([
	Schema.Array(ensureUserEntityItemSchema).pipe(
		Schema.check(Schema.isMaxLength(USER_ENTITY_WRITE_SANDBOX_LIMITS.items)),
	),
]);
export const ensureUserEntitiesDataSchema = Schema.Array(ensureUserEntityResultSchema);
export const ensureUserEntitiesResultSchema = hostResultSchema(ensureUserEntitiesDataSchema);
export const createUserEntityArgsSchema = Schema.Tuple([
	ensureUserEntityItemSchema,
	Schema.optional(Schema.UndefinedOr(submissionOptionsSchema)),
]);
export const createUserEntityDataSchema = strictStruct({ entityId: sandboxIdSchema });
export const createUserEntityResultSchema = hostResultSchema(createUserEntityDataSchema);
export const deleteUserEntityArgsSchema = Schema.Tuple([
	strictStruct({ entityId: sandboxIdSchema, entitySchemaSlug: nonEmptyString }),
	Schema.optional(Schema.UndefinedOr(submissionOptionsSchema)),
]);
export const deleteUserEntityDataSchema = strictStruct({ entityId: sandboxIdSchema });
export const deleteUserEntityResultSchema = hostResultSchema(deleteUserEntityDataSchema);
export const updateUserEntityArgsSchema = Schema.Tuple([
	strictStruct({
		entityId: sandboxIdSchema,
		name: ensureUserEntityItemSchema.fields.name,
		properties: ensureUserEntityItemSchema.fields.properties,
		expected: strictStruct({
			name: entityRecordSchema.fields.name,
			updatedAt: entityRecordSchema.fields.updatedAt,
			properties: ensureUserEntityItemSchema.fields.properties,
		}),
	}),
	Schema.optional(Schema.UndefinedOr(submissionOptionsSchema)),
]);
export const updateUserEntityDataSchema = strictStruct({ entityId: sandboxIdSchema });
export const updateUserEntityResultSchema = hostResultSchema(updateUserEntityDataSchema);
export const upsertGlobalEntitiesArgsSchema = Schema.Tuple([
	Schema.Array(upsertGlobalEntityItemSchema).pipe(
		Schema.check(Schema.isMaxLength(GLOBAL_WRITE_SANDBOX_LIMITS.entityItems)),
	),
	Schema.optionalKey(upsertGlobalEntitiesOptionsSchema),
]);
