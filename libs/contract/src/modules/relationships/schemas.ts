import { Schema } from "effect";

import { EntityId, RelationshipId, RelationshipSchemaId } from "../../schema/brands";

export const RelationshipScope = Schema.Struct({
	id: RelationshipId,
	createdAt: Schema.String,
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	properties: Schema.Unknown,
	wasInserted: Schema.Boolean,
	relationshipSchemaId: RelationshipSchemaId,
});

export type RelationshipScope = typeof RelationshipScope.Type;

export const CreateRelationshipBody = Schema.Struct({
	sourceEntityId: EntityId,
	targetEntityId: EntityId,
	relationshipSchemaId: RelationshipSchemaId,
	properties: Schema.optional(Schema.Unknown),
});

export type CreateRelationshipBody = typeof CreateRelationshipBody.Type;
