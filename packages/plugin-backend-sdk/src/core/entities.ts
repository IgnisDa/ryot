import { PluginId } from "@ryot-app/contract/schema/brands";
import { Message } from "@ryot-app/i18n/message";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { USER_ENTITY_READ_SANDBOX_LIMITS } from "./limits";
import { sandboxIdSchema } from "./primitives";

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
	name: Message,
	slug: Schema.String,
	providerId: Schema.String,
});
export const entitySchemaRecordSchema = strictStruct({
	name: Message,
	id: Schema.String,
	icon: Schema.String,
	slug: Schema.String,
	isBuiltin: Schema.Boolean,
	pluginId: Schema.NullOr(PluginId),
	propertiesSchema: jsonValueSchema,
	providers: Schema.Array(entitySchemaProviderSchema),
});
export type EntitySchemaRecord = Schema.Schema.Type<typeof entitySchemaRecordSchema>;
export const getEntitySchemasArgsSchema = Schema.Tuple([sandboxEntitySchemaSlugListSchema]);
export const getEntitySchemasResultSchema = hostResultSchema(
	Schema.Array(entitySchemaRecordSchema),
);
