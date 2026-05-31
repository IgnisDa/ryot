import { Schema } from "effect";

import { EntitySchemaId, EventSchemaId } from "../../schema/brands";
import { AppSchema } from "../../schema/property-schema";

export const ListedEventSchema = Schema.Struct({
	id: EventSchemaId,
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	entitySchemaId: EntitySchemaId,
});

export type ListedEventSchema = typeof ListedEventSchema.Type;

export const CreateEventSchemaBody = Schema.Struct({
	name: Schema.String,
	propertiesSchema: AppSchema,
	entitySchemaId: EntitySchemaId,
	slug: Schema.optional(Schema.String),
});

export type CreateEventSchemaBody = typeof CreateEventSchemaBody.Type;
