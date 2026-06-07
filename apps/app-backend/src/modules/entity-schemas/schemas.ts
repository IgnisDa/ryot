import { Schema } from "effect";

import { EntitySchemaId, SandboxScriptId, TrackerId } from "#lib/schema/brands";
import { AppSchema } from "#lib/schema/property-schema";

export const Provider = Schema.Struct({
	name: Schema.String,
	scriptId: SandboxScriptId,
});

export type Provider = typeof Provider.Type;

export const ListedEntitySchema = Schema.Struct({
	id: EntitySchemaId,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	trackerId: TrackerId,
	isBuiltin: Schema.Boolean,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	providers: Schema.Array(Provider),
});

export type ListedEntitySchema = typeof ListedEntitySchema.Type;

export const ListEntitySchemasBody = Schema.Struct({
	trackerId: Schema.optional(TrackerId),
	slugs: Schema.optional(Schema.Array(Schema.String)),
});

export type ListEntitySchemasBody = typeof ListEntitySchemasBody.Type;

export const CreateEntitySchemaBody = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	trackerId: TrackerId,
	accentColor: Schema.String,
	propertiesSchema: AppSchema,
	slug: Schema.optional(Schema.String),
});

export type CreateEntitySchemaBody = typeof CreateEntitySchemaBody.Type;

export const SearchEntitySchemasBody = Schema.Struct({
	scriptId: SandboxScriptId,
	context: Schema.optional(Schema.Unknown),
});

export type SearchEntitySchemasBody = typeof SearchEntitySchemasBody.Type;
