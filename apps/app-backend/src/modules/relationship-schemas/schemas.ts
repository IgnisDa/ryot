import { Schema } from "effect";

import { EntitySchemaId, RelationshipSchemaId } from "#lib/schema/brands";
import { AppSchema } from "#lib/schema/property-schema";

export const RelationshipSchemaScope = Schema.Struct({
	id: RelationshipSchemaId,
	slug: Schema.String,
	name: Schema.String,
	isBuiltin: Schema.Boolean,
	propertiesSchema: AppSchema,
	sourceEntitySchemaId: Schema.NullOr(EntitySchemaId),
	targetEntitySchemaId: Schema.NullOr(EntitySchemaId),
});

export type RelationshipSchemaScope = typeof RelationshipSchemaScope.Type;

export const ListRelationshipSchemasBody = Schema.Struct({
	slugs: Schema.optional(Schema.Array(Schema.String)),
	sourceEntitySchemaId: Schema.optional(Schema.NullOr(EntitySchemaId)),
	targetEntitySchemaId: Schema.optional(Schema.NullOr(EntitySchemaId)),
});

export type ListRelationshipSchemasBody = typeof ListRelationshipSchemasBody.Type;

export const CreateRelationshipSchemaBody = Schema.Struct({
	name: Schema.String,
	propertiesSchema: AppSchema,
	slug: Schema.optional(Schema.String),
	sourceEntitySchemaId: Schema.optional(Schema.NullOr(EntitySchemaId)),
	targetEntitySchemaId: Schema.optional(Schema.NullOr(EntitySchemaId)),
});

export type CreateRelationshipSchemaBody = typeof CreateRelationshipSchemaBody.Type;
