import { Schema } from "effect";

import { AppSchema } from "../../lib/schema";

export const RelationshipSchemaScope = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	isBuiltin: Schema.Boolean,
	propertiesSchema: AppSchema,
	sourceEntitySchemaId: Schema.NullOr(Schema.String),
	targetEntitySchemaId: Schema.NullOr(Schema.String),
});

export type RelationshipSchemaScope = typeof RelationshipSchemaScope.Type;
