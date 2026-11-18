import { PluginId } from "@ryot-app/contract/schema/brands";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { jsonValueSchema, strictStruct } from "../wire";

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
