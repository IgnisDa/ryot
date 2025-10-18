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
