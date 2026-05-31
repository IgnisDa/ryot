import { Schema } from "effect";

import { AppSchema } from "~/lib/schema";

export const ListedEventSchema = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	propertiesSchema: AppSchema,
	entitySchemaId: Schema.String,
});

export type ListedEventSchema = typeof ListedEventSchema.Type;

export const CreateEventSchemaBody = Schema.Struct({
	name: Schema.String,
	propertiesSchema: AppSchema,
	entitySchemaId: Schema.String,
	slug: Schema.optional(Schema.String),
});

export type CreateEventSchemaBody = typeof CreateEventSchemaBody.Type;
