import { PluginId } from "@ryot-app/contract/schema/brands";
import { Message } from "@ryot-app/i18n/message";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { sandboxEntitySchemaSlugListSchema } from "./entities";

export const eventSchemaRecordSchema = strictStruct({
	name: Message,
	id: Schema.String,
	slug: Schema.String,
	entitySchemaSlug: Schema.String,
	pluginId: Schema.NullOr(PluginId),
	propertiesSchema: jsonValueSchema,
});
export type EventSchemaRecord = Schema.Schema.Type<typeof eventSchemaRecordSchema>;
export const eventRecordSchema = strictStruct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	properties: jsonValueSchema,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	eventSchemaPluginId: Schema.NullOr(PluginId),
	sessionEntityId: Schema.optional(Schema.String),
});
export type EventRecord = Schema.Schema.Type<typeof eventRecordSchema>;
export const listEventSchemasDataSchema = Schema.Array(eventSchemaRecordSchema);
export const listEventSchemasArgsSchema = Schema.Tuple([sandboxEntitySchemaSlugListSchema]);
export const listEventSchemasResultSchema = hostResultSchema(listEventSchemasDataSchema);
