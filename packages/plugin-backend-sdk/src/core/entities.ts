import { PluginId } from "@ryot-app/contract/schema/brands";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { jsonValueSchema, strictStruct } from "../wire";

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
