import { Schema } from "effect";

import { AppSchema } from "../../lib/schema";

export const Provider = Schema.Struct({
	name: Schema.String,
	scriptId: Schema.String,
});

export type Provider = typeof Provider.Type;

export const ListedEntitySchema = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	trackerId: Schema.String,
	isBuiltin: Schema.Boolean,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	providers: Schema.Array(Provider),
});

export type ListedEntitySchema = typeof ListedEntitySchema.Type;

export const ListEntitySchemasBody = Schema.Struct({
	trackerId: Schema.optional(Schema.String),
	slugs: Schema.optional(Schema.Array(Schema.String)),
});

export type ListEntitySchemasBody = typeof ListEntitySchemasBody.Type;

export const CreateEntitySchemaBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	trackerId: Schema.String,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	slug: Schema.optional(Schema.String),
});

export type CreateEntitySchemaBody = typeof CreateEntitySchemaBody.Type;

export const SearchEntitySchemasBody = Schema.Struct({
	scriptId: Schema.String,
	context: Schema.optional(Schema.Unknown),
});

export type SearchEntitySchemasBody = typeof SearchEntitySchemasBody.Type;
